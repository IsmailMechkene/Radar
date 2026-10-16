// Headless entry point: `cli scan | remind | export`.
// Implemented so far: `scan` (store results in the database, for OS schedulers) and
// `scan --dry --source <name>` (fetch one source, print, save nothing).
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { getAdapter } from './core/adapters/registry';
import type { AdapterResult, RawItem } from './core/adapters/types';
import { migrate } from './core/db/migrate';
import { openDatabase, resolveDbPath } from './core/db/open';
import { createHttpClient, HttpError, RobotsDisallowedError } from './core/http/client';
import { defaultDataDir } from './core/paths';
import { compileRules } from './core/rules/engine';
import { profileFromSettings } from './core/rules/profile';
import { rescoreAll } from './core/rules/rescore';
import { parseRules } from './core/rules/schema';
import { runScan } from './core/runner';
import { getAllSettings, seedDefaultSettings } from './core/settings/store';
import { findSeedSource, parseSeedSources, type SeedSource } from './core/sources/seeds';
import { syncSeedSources } from './core/sources/sync';

const COMMANDS = ['scan', 'rescore', 'remind', 'export'] as const;
const USAGE = `Usage:
  radar scan [--source <name>]... [--db <file>]
  radar scan --dry --source <name> [--json] [--limit <n>]
  radar rescore [--db <file>]
  radar <remind|export>   (not implemented yet)

  scan       fetch every enabled source (or only the --source ones), store and score the results
  rescore    score every stored opportunity again with seeds/rules.json and your settings
  --db       database file (default: the app's own, e.g. %APPDATA%\\radar\\radar.db)
  --dry      fetch and print only; nothing is written to the database
  --source   a source name from seeds/sources.json (repeatable without --dry)
  --json     with --dry: print normalized items as JSON (without the raw payload)
  --limit    with --dry: print at most n items (default 50; all are still fetched and counted)`;

interface Args {
  command: string | undefined;
  dry: boolean;
  json: boolean;
  sources: string[];
  db: string | undefined;
  limit: number;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    command: argv[0],
    dry: false,
    json: false,
    sources: [],
    db: undefined,
    limit: 50,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') args.dry = true;
    else if (a === '--json') args.json = true;
    else if (a === '--source') args.sources.push(argv[++i] ?? '');
    else if (a === '--db') args.db = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
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

/** Scores every stored opportunity with seeds/rules.json and the stored settings. */
function rescoreDb(db: ReturnType<typeof openDatabase>): string {
  const rules = compileRules(
    parseRules(JSON.parse(readFileSync(resolve(process.cwd(), 'seeds', 'rules.json'), 'utf8'))),
  );
  seedDefaultSettings(db);
  const r = rescoreAll(db, rules, profileFromSettings(getAllSettings(db)), new Date());
  const v = r.byVerdict;
  return `Scored ${r.scored}: ${v.apply} apply, ${v.maybe} maybe, ${v.needs_review} needs review, ${v.skip} skip`;
}

async function rescoreCommand(args: Args): Promise<number> {
  const dbPath = dbPathFor(args);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    console.log(rescoreDb(db));
    return 0;
  } finally {
    db.close();
  }
}

/** Real scan into the app's database (or --db). Seeds are synced first; results are scored. */
async function scanLive(args: Args): Promise<number> {
  const dbPath = dbPathFor(args);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
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
  if (!args.command || !(COMMANDS as readonly string[]).includes(args.command)) {
    console.error(USAGE);
    return 1;
  }
  console.error(`radar ${args.command}: not implemented yet (only "scan" and "rescore" work)`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
