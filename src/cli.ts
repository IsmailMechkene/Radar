// Headless entry point: `cli scan | remind | export`.
// Implemented so far: `scan --dry --source <name>` (fetch one source, print, save nothing).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAdapter } from './core/adapters/registry';
import type { AdapterResult, RawItem } from './core/adapters/types';
import { createHttpClient, HttpError, RobotsDisallowedError } from './core/http/client';
import { findSeedSource, parseSeedSources, type SeedSource } from './core/sources/seeds';

const COMMANDS = ['scan', 'remind', 'export'] as const;
const USAGE = `Usage:
  radar scan --dry --source <name> [--json] [--limit <n>]
  radar <${COMMANDS.join('|')}>   (not implemented yet)

  --dry      fetch and print only; nothing is written to the database
  --source   a source name from seeds/sources.json
  --json     print normalized items as JSON (without the raw payload)
  --limit    print at most n items (default 50; all are still fetched and counted)`;

interface Args {
  command: string | undefined;
  dry: boolean;
  json: boolean;
  source: string | undefined;
  limit: number;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { command: argv[0], dry: false, json: false, source: undefined, limit: 50 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') args.dry = true;
    else if (a === '--json') args.json = true;
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else throw new Error(`Unknown argument "${a}"`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 0)
    throw new Error('--limit must be a whole number');
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
  for (const i of result.items)
    byType.set(i.opportunity_type, (byType.get(i.opportunity_type) ?? 0) + 1);
  const types = [...byType].map(([t, n]) => `${t} ${n}`).join(', ');
  return `${result.items.length} items (${types || 'none'}), ${result.errors.length} skipped with errors`;
}

async function scanDry(args: Args): Promise<number> {
  if (!args.source) {
    console.error('scan --dry needs --source <name>.\n');
    console.error(USAGE);
    return 1;
  }
  const seeds = loadSeeds();
  const source = findSeedSource(seeds, args.source);
  if (!source) {
    console.error(
      `No source named "${args.source}". Known: ${seeds.map((s) => s.name).join(', ')}`,
    );
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
    if (result.items.length > shown.length)
      console.log(`  … ${result.items.length - shown.length} more`);
    for (const e of result.errors) {
      console.log(
        `  ! skipped item #${e.index}${e.externalId ? ` (${e.externalId})` : ''}: ${e.reason}`,
      );
    }
  }
  console.error(summarize(result));
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 1;
  }
  if (args.command === 'scan' && args.dry) return scanDry(args);
  if (!args.command || !(COMMANDS as readonly string[]).includes(args.command)) {
    console.error(USAGE);
    return 1;
  }
  console.error(`radar ${args.command}: not implemented yet (only "scan --dry" works)`);
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
