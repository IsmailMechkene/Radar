// Headless entry point: `cli scan | rescore | remind | export`.
// Implemented so far: `scan` (store results in the database, for OS schedulers),
// `scan --dry --source <name>` (fetch one source, print, save nothing), `rescore`, and
// `remind --dry --now <time>` (what would fire at that time, on a copy; nothing is saved).
// The database is encrypted: every command that reads it needs the password (or recovery key).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { getAdapter } from './core/adapters/registry';
import type { AdapterResult, RawItem } from './core/adapters/types';
import { migrate } from './core/db/migrate';
import { applyKey, openDatabase, resolveDbPath } from './core/db/open';
import { prepareEncryptedDatabase } from './core/vault/encrypt';
import {
  readKeyFile,
  unlockWithPassword,
  unlockWithRecoveryKey,
  WrongSecretError,
} from './core/vault/keys';
import { createHttpClient, HttpError, RobotsDisallowedError } from './core/http/client';
import { extractDeadlines } from './core/deadlines/postings';
import { defaultDataDir } from './core/paths';
import { parseSeedPrograms, syncSeedPrograms } from './core/programs/seeds';
import { isQuietTime } from './core/reminders/quiet';
import { fireDue, syncReminders } from './core/reminders/store';
import { compileRules } from './core/rules/engine';
import { profileFromSettings } from './core/rules/profile';
import { rescoreAll } from './core/rules/rescore';
import { parseRules } from './core/rules/schema';
import { effectiveRules } from './core/rules/store';
import { runScan } from './core/runner';
import { getAllSettings, getSetting, seedDefaultSettings } from './core/settings/store';
import { findSeedSource, parseSeedSources, type SeedSource } from './core/sources/seeds';
import { syncSeedSources } from './core/sources/sync';
import { zonedToUtc } from './core/time';

const COMMANDS = ['scan', 'rescore', 'remind', 'export'] as const;
const USAGE = `Usage:
  radar scan [--source <name>]... [--db <file>]
  radar scan --dry --source <name> [--json] [--limit <n>]
  radar rescore [--db <file>]
  radar remind --dry [--now <time>] [--db <file>]
  radar export   (not implemented yet)

  scan       fetch every enabled source (or only the --source ones), store and score the results
  rescore    score every stored opportunity again with seeds/rules.json and your settings
  remind     with --dry: print the notifications that would fire at --now (default: now),
             planned on an in-memory copy of the database; nothing is saved
  --now      2026-10-19T09:00 (your Settings time zone) or a full ISO time with Z or an offset
  --db       database file (default: the app's own, e.g. %APPDATA%\\radar\\radar.db)
  --dry      fetch and print only; nothing is written to the database
  --source   a source name from seeds/sources.json (repeatable without --dry)
  --json     with --dry: print normalized items as JSON (without the raw payload)
  --limit    with --dry: print at most n items (default 50; all are still fetched and counted)
  --recovery-key  ask for the recovery key instead of the password

The database is encrypted. Commands that read it ask for your password, or take it from the
RADAR_PASSWORD (or RADAR_RECOVERY_KEY) environment variable when there is no terminal, e.g. under
an OS scheduler. keys.json must sit next to the database file.`;

interface Args {
  command: string | undefined;
  dry: boolean;
  json: boolean;
  sources: string[];
  db: string | undefined;
  limit: number;
  now: string | undefined;
  recoveryKey: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    command: argv[0],
    dry: false,
    json: false,
    sources: [],
    db: undefined,
    limit: 50,
    now: undefined,
    recoveryKey: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') args.dry = true;
    else if (a === '--json') args.json = true;
    else if (a === '--source') args.sources.push(argv[++i] ?? '');
    else if (a === '--db') args.db = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--now') args.now = argv[++i];
    else if (a === '--recovery-key') args.recoveryKey = true;
    else throw new Error(`Unknown argument "${a}"`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 0) {
    throw new Error('--limit must be a whole number');
  }
  return args;
}

function loadSeeds(): SeedSource[] {
  const file = resolve(process.cwd(), 'seeds', 'sources.json');
  return parseSeedSources(JSON.parse(readFileSync(file, 'utf8')));
}

function line(item: RawItem): string {
  const meta = [
    item.org,
    item.location,
    item.remote_type,
    item.posted_at?.slice(0, 10),
    item.language,
  ]
    .filter(Boolean)
    .join(' · ');
  const deadline = item.deadline_text ? `\n      deadline: “${item.deadline_text}”` : '';
  return `  [${item.opportunity_type}] ${item.title}\n      ${meta}\n      ${item.url}${deadline}`;
}

function summarize(result: AdapterResult): string {
  const byType = new Map<string, number>();
  for (const i of result.items) {
    byType.set(i.opportunity_type, (byType.get(i.opportunity_type) ?? 0) + 1);
  }
  const types = [...byType].map(([t, n]) => `${t} ${n}`).join(', ');
  return `${result.items.length} items (${types || 'none'}), ${result.errors.length} skipped with errors`;
}

async function scanDry(args: Args): Promise<number> {
  if (args.sources.length !== 1) {
    console.error('scan --dry needs exactly one --source <name>.\n');
    console.error(USAGE);
    return 1;
  }
  const name = args.sources[0]!;
  const seeds = loadSeeds();
  const source = findSeedSource(seeds, name);
  if (!source) {
    console.error(`No source named "${name}". Known: ${seeds.map((s) => s.name).join(', ')}`);
    return 1;
  }
  if (source.status !== 'active') {
    console.error(`"${source.name}" is ${source.status}: ${source.note ?? 'no adapter yet'}`);
    return 1;
  }

  const adapter = getAdapter(source.kind);
  const http = createHttpClient();
  console.error(`Dry run: ${source.name} (${source.kind}). Nothing is saved.`);
  let result: AdapterResult;
  try {
    result = await adapter.fetchItems(source, { http });
  } catch (err) {
    const kind =
      err instanceof RobotsDisallowedError
        ? 'refused by robots.txt'
        : err instanceof HttpError
          ? 'request failed'
          : 'failed';
    console.error(`${source.name}: ${kind}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const shown = result.items.slice(0, args.limit);
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          source: source.name,
          items: shown.map(({ raw: _raw, ...rest }) => rest),
          errors: result.errors.map(({ raw: _raw, ...rest }) => rest),
          total: result.items.length,
        },
        null,
        2,
      ),
    );
  } else {
    for (const item of shown) console.log(line(item));
    if (result.items.length > shown.length) {
      console.log(`  … ${result.items.length - shown.length} more`);
    }
    for (const e of result.errors) {
      console.log(
        `  ! skipped item #${e.index}${e.externalId ? ` (${e.externalId})` : ''}: ${e.reason}`,
      );
    }
  }
  console.error(summarize(result));
  return 0;
}

function dbPathFor(args: Args): string {
  return args.db
    ? resolve(args.db)
    : resolveDbPath(defaultDataDir(process.platform, process.env, homedir()));
}

/** A problem the user fixes (missing password, no keys.json): printed without a stack trace. */
class UnlockError extends Error {
  override name = 'UnlockError';
}

/** Reads a secret from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (err?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') return finish(new Error('Cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

/** The data key, from the environment or a prompt. keys.json lives next to the database. */
async function dataKeyFor(dbPath: string, args: Args): Promise<Buffer> {
  const file = readKeyFile(dirname(dbPath));
  if (!file) {
    throw new UnlockError(
      `No keys.json next to ${dbPath}: open Radar once and set a password first.`,
    );
  }
  const envRecovery = process.env['RADAR_RECOVERY_KEY'];
  const envPassword = process.env['RADAR_PASSWORD'];
  if (args.recoveryKey || (!envPassword && envRecovery)) {
    const key = envRecovery ?? (process.stdin.isTTY ? await promptHidden('Recovery key: ') : '');
    if (!key) throw new UnlockError('Set RADAR_RECOVERY_KEY or run in a terminal to type it.');
    return unlockWithRecoveryKey(file, key);
  }
  const password = envPassword ?? (process.stdin.isTTY ? await promptHidden('Password: ') : '');
  if (!password) throw new UnlockError('Set RADAR_PASSWORD or run in a terminal to type it.');
  return unlockWithPassword(file, password);
}

/** Opens the app's encrypted database (encrypting a plain one left from before). */
async function openAppDatabase(dbPath: string, args: Args) {
  const key = await dataKeyFor(dbPath, args);
  try {
    await prepareEncryptedDatabase(dirname(dbPath), key);
    if (!existsSync(dbPath)) mkdirSync(dirname(dbPath), { recursive: true });
    return openDatabase(dbPath, key);
  } finally {
    key.fill(0);
  }
}

/** Scores every stored opportunity with seeds/rules.json and the stored settings. */
function rescoreDb(db: ReturnType<typeof openDatabase>): string {
  const defaults = parseRules(
    JSON.parse(readFileSync(resolve(process.cwd(), 'seeds', 'rules.json'), 'utf8')),
  );
  const effective = effectiveRules(db, defaults);
  if (effective.error) console.error(effective.error);
  const rules = compileRules(effective.rules);
  seedDefaultSettings(db);
  extractDeadlines(db, getSetting(db, 'timezone'));
  const r = rescoreAll(db, rules, profileFromSettings(getAllSettings(db)), new Date());
  const v = r.byVerdict;
  return `Scored ${r.scored}: ${v.apply} apply, ${v.maybe} maybe, ${v.needs_review} needs review, ${v.skip} skip`;
}

async function rescoreCommand(args: Args): Promise<number> {
  const dbPath = dbPathFor(args);
  const db = await openAppDatabase(dbPath, args);
  try {
    migrate(db);
    console.log(rescoreDb(db));
    return 0;
  } finally {
    db.close();
  }
}

/** "2026-10-19T09:00" is local time in `timeZone`; a value with Z or an offset is absolute. */
export function parseNow(value: string, timeZone: string): Date {
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error(`--now: cannot read "${value}"`);
    return d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!m) throw new Error(`--now: expected 2026-10-19T09:00, got "${value}"`);
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return zonedToUtc(+y!, +mo!, +d!, +h, +mi, +s, 0, timeZone);
}

/** What would fire at --now, computed on an in-memory copy (the real file is opened read-only). */
async function remindDry(args: Args): Promise<number> {
  if (!args.dry) {
    console.error('Only "remind --dry" exists; the app fires reminders itself.\n');
    console.error(USAGE);
    return 1;
  }
  const dbPath = dbPathFor(args);
  let db: Database.Database;
  if (existsSync(dbPath)) {
    const key = await dataKeyFor(dbPath, args);
    const file = new Database(dbPath, { readonly: true, fileMustExist: true });
    let image: Buffer;
    try {
      applyKey(file, key);
      image = file.serialize(); // decrypted pages: the copy lives only in memory
    } finally {
      file.close();
      key.fill(0);
    }
    // The app's file is in WAL mode, which an in-memory copy cannot use: mark the copy as a
    // rollback-journal database (header bytes 18-19) so it can be written.
    image[18] = 1;
    image[19] = 1;
    db = new Database(image);
  } else {
    console.error(`No database at ${dbPath}; using an empty one.`);
    db = new Database(':memory:');
  }
  try {
    migrate(db);
    seedDefaultSettings(db);
    const timeZone = getSetting(db, 'timezone');
    const now = args.now ? parseNow(args.now, timeZone) : new Date();
    const programs = parseSeedPrograms(
      JSON.parse(readFileSync(resolve(process.cwd(), 'seeds', 'programs.json'), 'utf8')),
    );
    syncSeedPrograms(db, programs, timeZone, now);
    extractDeadlines(db, timeZone);
    const quietHours = getSetting(db, 'quietHours');
    const quiet = isQuietTime(now, quietHours, timeZone);
    const local = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone,
    }).format(now);
    console.log(`Dry run at ${local} (${timeZone}). Nothing is saved.`);
    syncReminders(db, now, timeZone);
    // Fire with quiet hours off to list what is due; report quiet hours separately.
    const r = fireDue(db, now, { timeZone, quietHours: { ...quietHours, enabled: false } });
    if (r.notices.length === 0) console.log('Nothing would fire.');
    for (const n of r.notices) {
      const extra = n.collapsed ? ` (+${n.collapsed} earlier, collapsed)` : '';
      console.log(`  • ${n.title}${extra}\n      ${n.body.replace(/\n/g, '\n      ')}`);
    }
    if (quiet && r.notices.length) {
      console.log(
        `Quiet hours (${quietHours.start}-${quietHours.end}): these would wait until they end.`,
      );
    }
    const upcoming = db
      .prepare(
        `SELECT r.kind, r.due_at,
                CASE r.target_type
                  WHEN 'opportunity' THEN (SELECT org || ' · ' || title FROM opportunities WHERE id = r.target_id)
                  WHEN 'program' THEN (SELECT name FROM programs WHERE id = r.target_id)
                  ELSE (SELECT 'Follow-up · ' || org FROM pipeline WHERE id = r.target_id)
                END AS label
           FROM reminders r
          WHERE r.fired_at IS NULL AND r.done_at IS NULL ORDER BY r.due_at LIMIT 8`,
      )
      .all() as { kind: string; due_at: string; label: string | null }[];
    if (upcoming.length) {
      console.log('Next planned:');
      const fmt = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      });
      for (const u of upcoming) {
        console.log(
          `  ${fmt.format(new Date(u.due_at))}  ${u.kind.padEnd(12)}  ${u.label ?? '(removed)'}`,
        );
      }
    }
    return 0;
  } finally {
    db.close();
  }
}

/** Real scan into the app's database (or --db). Seeds are synced first; results are scored. */
async function scanLive(args: Args): Promise<number> {
  const dbPath = dbPathFor(args);
  const db = await openAppDatabase(dbPath, args);
  try {
    migrate(db);
    const seeds = loadSeeds();
    const known = new Set(seeds.map((s) => s.name.toLowerCase()));
    const unknown = args.sources.filter((s) => !known.has(s.toLowerCase()));
    if (unknown.length) {
      console.error(
        `Unknown source(s): ${unknown.join(', ')}. Known: ${seeds.map((s) => s.name).join(', ')}`,
      );
      return 1;
    }
    syncSeedSources(db, seeds, new Date());
    console.error(`Scanning into ${dbPath}`);
    const summary = await runScan(db, {
      http: createHttpClient(),
      trigger: 'cli',
      only: args.sources.length ? args.sources : undefined,
      onSource: (o, done, total) => {
        const what = o.ok
          ? `${o.items} items, ${o.inserted} new, ${o.closed} closed` +
            (o.skipped ? `, ${o.skipped} skipped` : '')
          : `FAILED: ${o.error}`;
        console.log(`  [${done}/${total}] ${o.name}: ${what}`);
      },
    });
    console.log(
      `Run #${summary.runId}: ${summary.sourcesOk} ok, ${summary.sourcesFailed} failed, ` +
        `${summary.newItems} new`,
    );
    if (summary.errorSummary) console.log(`Problems:\n${summary.errorSummary}`);
    console.log(rescoreDb(db));
    return summary.sourcesFailed > 0 && summary.sourcesOk === 0 ? 1 : 0;
  } finally {
    db.close();
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 1;
  }
  if (args.command === 'scan') return args.dry ? scanDry(args) : scanLive(args);
  if (args.command === 'rescore') return rescoreCommand(args);
  if (args.command === 'remind') return remindDry(args);
  if (!args.command || !(COMMANDS as readonly string[]).includes(args.command)) {
    console.error(USAGE);
    return 1;
  }
  console.error(
    `radar ${args.command}: not implemented yet (only "scan", "rescore" and "remind --dry" work)`,
  );
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const expected = err instanceof UnlockError || err instanceof WrongSecretError;
    console.error(expected ? (err as Error).message : err);
    process.exitCode = 1;
  },
);
