// The Sources page's data: every source with its health, how many open postings it lists, and
// the controls (pause, add, delete, test fetch). Health uses the same "broken" rule as the
// sidebar count (src/core/nav.ts).
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { ashbyConfigSchema } from '../adapters/ashby';
import { greenhouseConfigSchema } from '../adapters/greenhouse';
import { leverConfigSchema } from '../adapters/lever';
import {
  BOARD_LABELS,
  BOARD_LINK_HINT,
  boardFrom,
  boardPageUrl,
  type BoardPlatform,
} from './boards';
import { ADAPTERS } from '../adapters/registry';
import type { AdapterSource } from '../adapters/types';
import { insertSource } from '../db/sources';
import { sourceRowSchema, type SourceRow } from '../db/schemas';
import type { HttpClient } from '../http/client';
import { BROKEN_AFTER_EMPTY_RUNS } from '../nav';
import { normalizePageText } from '../watch/pages';
import { PAGE_KIND } from './seeds';

export type SourceHealth = 'healthy' | 'warning' | 'broken' | 'paused' | 'unavailable' | 'new';

/** Same order of checks as the user would read them: off first, then failures. */
export function sourceHealth(s: SourceRow): SourceHealth {
  if (s.paused) return 'paused';
  if (!s.enabled) return 'unavailable';
  if (s.last_error !== null || s.consecutive_empty >= BROKEN_AFTER_EMPTY_RUNS) return 'broken';
  if (s.consecutive_empty > 0) return 'warning';
  return s.last_ok_at ? 'healthy' : 'new';
}

export interface SourceItem {
  id: number;
  kind: string;
  name: string;
  url: string | null;
  access_method: SourceRow['access_method'];
  /** Adapter config without bookkeeping keys. */
  config: Record<string, unknown>;
  /** Why a pending source is not scanned yet (from the seed). */
  note: string | null;
  tos_note: string | null;
  health: SourceHealth;
  last_ok_at: string | null;
  last_error: string | null;
  consecutive_empty: number;
  /** Open postings this source lists right now (null for watched pages). */
  found: number | null;
  paused: boolean;
  added_by_user: boolean;
  /** A program this page belongs to. */
  program: string | null;
}

export function listSourceItems(db: Database.Database): SourceItem[] {
  const rows = db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(DISTINCT os.opportunity_id) FROM opportunity_sources os
                 JOIN opportunities o ON o.id = os.opportunity_id
                WHERE os.source_id = s.id AND o.closed_at IS NULL) AS found,
              (SELECT name FROM programs WHERE source_id = s.id) AS program
         FROM sources s
        WHERE s.kind <> 'sample'
        ORDER BY s.id`,
    )
    .all() as (Record<string, unknown> & { found: number; program: string | null })[];
  return rows.map((r) => {
    const s = sourceRowSchema.parse(r);
    const parsed = JSON.parse(s.config_json) as Record<string, unknown>;
    const config = Object.fromEntries(Object.entries(parsed).filter(([k]) => !k.startsWith('_')));
    return {
      id: s.id,
      kind: s.kind,
      name: s.name,
      url: s.url,
      access_method: s.access_method,
      config,
      note: typeof parsed['_note'] === 'string' ? parsed['_note'] : null,
      tos_note: s.tos_note,
      health: sourceHealth(s),
      last_ok_at: s.last_ok_at,
      last_error: s.last_error,
      consecutive_empty: s.consecutive_empty,
      found: s.kind === PAGE_KIND ? null : r.found,
      paused: s.paused,
      added_by_user: s.added_by_user,
      program: r.program,
    };
  });
}

function getRow(db: Database.Database, id: number): SourceRow {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (row === undefined) throw new Error(`No source with id ${id}`);
  return sourceRowSchema.parse(row);
}

export function setSourcePaused(db: Database.Database, id: number, paused: boolean): void {
  const row = getRow(db, id);
  if (!row.enabled && !paused)
    throw new Error(`${row.name} has no adapter yet and cannot be turned on`);
  db.prepare('UPDATE sources SET paused = ? WHERE id = ?').run(paused ? 1 : 0, id);
}

// ---------- adding ----------

/** "https://jobs.ashbyhq.com/mistral.ai/…" or "mistral.ai" -> "mistral.ai". */
export function ashbyBoardFrom(input: string): string | null {
  return boardFrom('ashby', input);
}

const webUrl = z
  .string()
  .trim()
  .refine((s) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s), 'must be an http(s) link');

const boardSource = <T extends BoardPlatform>(type: T) =>
  z.strictObject({
    type: z.literal(type),
    /** Board name or its link (jobs.ashbyhq.com/…, job-boards.greenhouse.io/…, jobs.lever.co/…). */
    board: z.string().trim().min(1),
    org: z.string().trim().min(1).max(200),
  });

export const newSourceSchema = z.discriminatedUnion('type', [
  boardSource('ashby'),
  boardSource('greenhouse'),
  boardSource('lever'),
  z.strictObject({
    type: z.literal('page'),
    name: z.string().trim().min(1).max(200),
    url: webUrl,
  }),
]);
export type NewSource = z.input<typeof newSourceSchema>;

/** The source as the adapters (and Test fetch) see it, before it is saved. */
export function adapterSourceFor(input: NewSource): AdapterSource {
  const s = newSourceSchema.parse(input);
  if (s.type === 'page') return { kind: PAGE_KIND, name: s.name, url: s.url, config: {} };
  const board = boardFrom(s.type, s.board);
  if (!board) {
    throw new Error(
      `Paste the ${BOARD_LABELS[s.type]} board link (${BOARD_LINK_HINT[s.type]}) or its name`,
    );
  }
  const config =
    s.type === 'lever'
      ? leverConfigSchema.parse({ site: board, org: s.org })
      : s.type === 'greenhouse'
        ? greenhouseConfigSchema.parse({ board, org: s.org })
        : ashbyConfigSchema.parse({ board, org: s.org });
  return { kind: s.type, name: s.org, url: boardPageUrl(s.type, board), config };
}

const BOARD_TOS: Record<BoardPlatform, string> = {
  ashby: 'Added by you: Ashby public Job Postings API, no key.',
  greenhouse:
    'Added by you: Greenhouse Job Board API, no key ("Job Board data is publicly available").',
  lever:
    'Added by you: Lever postings API, no key (published postings are public); robots.txt Crawl-delay 1 is honored.',
};

export function addSource(db: Database.Database, input: NewSource, now: Date): SourceItem {
  const src = adapterSourceFor(input);
  if (db.prepare('SELECT 1 FROM sources WHERE kind = ? AND name = ?').get(src.kind, src.name)) {
    throw new Error(`A source named "${src.name}" already exists`);
  }
  const row = insertSource(
    db,
    {
      kind: src.kind,
      name: src.name,
      url: src.url,
      config: src.config as Record<string, unknown>,
      access_method: src.kind === PAGE_KIND ? 'public_html' : 'api',
      tos_note:
        src.kind === PAGE_KIND
          ? 'Added by you: page fetched about once a day through the shared fetch layer (robots.txt, 1 request/s per host).'
          : BOARD_TOS[src.kind as BoardPlatform],
    },
    now,
  );
  db.prepare('UPDATE sources SET added_by_user = 1 WHERE id = ?').run(row.id);
  return listSourceItems(db).find((s) => s.id === row.id)!;
}

/** Deletes a source you added. One that already brought postings is paused instead (kept history). */
export function deleteSource(db: Database.Database, id: number): number {
  const row = getRow(db, id);
  if (!row.added_by_user)
    throw new Error(
      `${row.name} comes from the seed file and returns at every start; pause it instead`,
    );
  const used = db
    .prepare('SELECT COUNT(*) FROM opportunity_sources WHERE source_id = ?')
    .pluck()
    .get(id) as number;
  if (used > 0)
    throw new Error(
      `${row.name} has found ${used} posting${used === 1 ? '' : 's'}; pause it instead to keep them`,
    );
  return db.transaction(() => {
    db.prepare('UPDATE programs SET source_id = NULL WHERE source_id = ?').run(id);
    return db.prepare('DELETE FROM sources WHERE id = ?').run(id).changes;
  })();
}

// ---------- test fetch ----------

export interface TestedItem {
  title: string;
  org: string;
  location: string | null;
  type: string;
  url: string;
}

export type TestResult =
  | { ok: false; ms: number; error: string }
  | { ok: true; ms: number; kind: 'items'; total: number; skipped: number; items: TestedItem[] }
  | { ok: true; ms: number; kind: 'page'; totalLines: number; lines: string[] };

const SHOWN = 25;

/**
 * Fetches a source exactly like a scan or page check would (adapter or page normalizer, shared
 * fetch layer), and stores nothing.
 */
export async function testFetch(
  source: AdapterSource,
  http: HttpClient,
  clock: () => number = () => Date.now(),
): Promise<TestResult> {
  const start = clock();
  const ms = () => Math.max(0, clock() - start);
  try {
    if (source.kind === PAGE_KIND) {
      if (!source.url) throw new Error('No page URL');
      const res = await http.get(source.url, { accept: 'text/html', language: 'en-US,en;q=0.9' });
      const lines = normalizePageText(res.body).split('\n').filter(Boolean);
      return {
        ok: true,
        ms: ms(),
        kind: 'page',
        totalLines: lines.length,
        lines: lines.slice(0, 12),
      };
    }
    const adapter = ADAPTERS[source.kind];
    if (!adapter) throw new Error(`No adapter for "${source.kind}" yet`);
    const r = await adapter.fetchItems(source, { http });
    return {
      ok: true,
      ms: ms(),
      kind: 'items',
      total: r.items.length,
      skipped: r.errors.length,
      items: r.items.slice(0, SHOWN).map((i) => ({
        title: i.title,
        org: i.org,
        location: i.location,
        type: i.opportunity_type,
        url: i.url,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      ms: ms(),
      error: (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 300),
    };
  }
}

/** A stored source as the adapters see it. */
export function adapterSourceOf(db: Database.Database, id: number): AdapterSource {
  const s = getRow(db, id);
  const parsed = JSON.parse(s.config_json) as Record<string, unknown>;
  return {
    kind: s.kind,
    name: s.name,
    url: s.url,
    config: Object.fromEntries(Object.entries(parsed).filter(([k]) => !k.startsWith('_'))),
  };
}
