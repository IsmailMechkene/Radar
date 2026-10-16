// Scan orchestration (M3): fetch each enabled source through its adapter, store items with
// dedupe, track first/last seen, close postings that disappeared, and log the run.
// Network calls happen outside transactions; each source's writes are one transaction.
import type Database from 'better-sqlite3';
import { ADAPTERS } from './adapters/registry';
import type { Adapter, AdapterResult, RawItem } from './adapters/types';
import { upsertOpportunity } from './db/opportunities';
import { finishRun, startRun, type RunTrigger } from './db/runs';
import { sourceRowSchema, type OpportunityInput, type SourceRow } from './db/schemas';
import { canonicalUrl, dedupeKey } from './dedupe';
import type { HttpClient } from './http/client';

export interface SourceOutcome {
  sourceId: number;
  name: string;
  ok: boolean;
  /** Items the adapter returned. */
  items: number;
  inserted: number;
  updated: number;
  /** Opportunities marked closed because this source no longer lists them. */
  closed: number;
  /** Items the adapter skipped as malformed. */
  skipped: number;
  error: string | null;
}

export interface ScanSummary {
  runId: number;
  outcomes: SourceOutcome[];
  sourcesOk: number;
  sourcesFailed: number;
  newItems: number;
  errorSummary: string | null;
}

export interface ScanOptions {
  http: HttpClient;
  trigger: RunTrigger;
  /** Limit to these source names (case-insensitive); default all enabled sources. */
  only?: readonly string[];
  now?: () => Date;
  /** Injectable for tests; defaults to the registry. */
  adapters?: Readonly<Record<string, Adapter>>;
  /** Called after each source, e.g. to report progress. */
  onSource?: (outcome: SourceOutcome, done: number, total: number) => void;
}

/** Enabled sources that have an adapter (pending, sample and unknown kinds are not scanned). */
export function scannableSources(
  db: Database.Database,
  adapters: Readonly<Record<string, Adapter>> = ADAPTERS,
  only?: readonly string[],
): SourceRow[] {
  const wanted = only?.map((n) => n.trim().toLowerCase());
  return db
    .prepare('SELECT * FROM sources WHERE enabled = 1 ORDER BY id')
    .all()
    .map((r) => sourceRowSchema.parse(r))
    .filter((s) => s.kind in adapters)
    .filter((s) => !wanted || wanted.includes(s.name.toLowerCase()));
}

/**
 * Adapters may not know the type ('unknown'); the database has no such value. No student or
 * program signal on a company board means a regular job, so it is stored as 'fulltime'.
 */
function toInput(item: RawItem, sourceId: number): OpportunityInput {
  const url = canonicalUrl(item.url);
  return {
    dedupe_key: dedupeKey(item),
    source_id: sourceId,
    org: item.org,
    title: item.title,
    location: item.location,
    remote_type: item.remote_type,
    opportunity_type: item.opportunity_type === 'unknown' ? 'fulltime' : item.opportunity_type,
    language: item.language,
    url,
    apply_url: item.apply_url,
    description: item.description,
    posted_at: item.posted_at,
    deadline_text: item.deadline_text,
  };
}

/** Writes one source's successful result. Returns counts. */
function storeResult(
  db: Database.Database,
  source: SourceRow,
  result: AdapterResult,
  at: Date,
): Pick<SourceOutcome, 'inserted' | 'updated' | 'closed'> {
  const iso = at.toISOString();
  return db.transaction(() => {
    let inserted = 0;
    let updated = 0;
    // The same posting can come back under another dedupe key (title edited); the canonical URL
    // already linked to an opportunity wins.
    const byUrl = db.prepare(
      `SELECT o.dedupe_key FROM opportunity_sources os JOIN opportunities o ON o.id = os.opportunity_id
        WHERE os.url = ? LIMIT 1`,
    );
    for (const item of result.items) {
      const input = toInput(item, source.id);
      const known = byUrl.get(input.url) as { dedupe_key: string } | undefined;
      if (known) input.dedupe_key = known.dedupe_key;
      const r = upsertOpportunity(db, input, at);
      if (r.inserted) inserted += 1;
      else updated += 1;
    }

    db.prepare(
      'UPDATE sources SET last_ok_at = ?, last_error = NULL, consecutive_empty = ? WHERE id = ?',
    ).run(iso, result.items.length === 0 ? source.consecutive_empty + 1 : 0, source.id);

    // Close what disappeared, but never on an empty answer (a broken source must not close
    // everything). An opportunity closes only when every source linking it has been scanned
    // successfully since it was last seen there.
    let closed = 0;
    if (result.items.length > 0) {
      closed = db
        .prepare(
          `UPDATE opportunities SET closed_at = @at
            WHERE closed_at IS NULL
              AND id IN (SELECT opportunity_id FROM opportunity_sources WHERE source_id = @source)
              AND NOT EXISTS (
                SELECT 1 FROM opportunity_sources os JOIN sources s ON s.id = os.source_id
                 WHERE os.opportunity_id = opportunities.id
                   AND (s.last_ok_at IS NULL OR os.last_seen_at >= s.last_ok_at))`,
        )
        .run({ at: iso, source: source.id }).changes;
    }
    return { inserted, updated, closed };
  })();
}

/** Source config as stored, minus bookkeeping keys such as `_note` (adapters validate strictly). */
function adapterConfig(configJson: string): Record<string, unknown> {
  const parsed = JSON.parse(configJson) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => !k.startsWith('_')));
}

function oneLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 300);
}

/** Runs one scan over the selected sources and records it in `runs`. Never throws per source. */
export async function runScan(db: Database.Database, opts: ScanOptions): Promise<ScanSummary> {
  const now = opts.now ?? (() => new Date());
  const adapters = opts.adapters ?? ADAPTERS;
  const sources = scannableSources(db, adapters, opts.only);
  const runId = startRun(db, opts.trigger, now());
  const outcomes: SourceOutcome[] = [];

  for (const source of sources) {
    const base = { sourceId: source.id, name: source.name };
    let outcome: SourceOutcome;
    try {
      const result = await adapters[source.kind]!.fetchItems(
        {
          name: source.name,
          kind: source.kind,
          url: source.url,
          config: adapterConfig(source.config_json),
        },
        { http: opts.http },
      );
      const counts = storeResult(db, source, result, now());
      outcome = {
        ...base,
        ok: true,
        items: result.items.length,
        skipped: result.errors.length,
        error: null,
        ...counts,
      };
      for (const e of result.errors) {
        console.warn(`[scan] ${source.name}: skipped item #${e.index}: ${oneLine(e.reason)}`);
      }
    } catch (err) {
      const message = oneLine(err);
      db.prepare('UPDATE sources SET last_error = ? WHERE id = ?').run(message, source.id);
      console.error(`[scan] ${source.name} failed: ${message}`);
      outcome = {
        ...base,
        ok: false,
        items: 0,
        inserted: 0,
        updated: 0,
        closed: 0,
        skipped: 0,
        error: message,
      };
    }
    outcomes.push(outcome);
    opts.onSource?.(outcome, outcomes.length, sources.length);
  }

  const problems = outcomes.flatMap((o) => [
    ...(o.error ? [`${o.name}: ${o.error}`] : []),
    ...(o.skipped ? [`${o.name}: ${o.skipped} item(s) skipped as malformed`] : []),
    ...(o.ok && o.items === 0 ? [`${o.name}: returned no items`] : []),
  ]);
  const summary: ScanSummary = {
    runId,
    outcomes,
    sourcesOk: outcomes.filter((o) => o.ok).length,
    sourcesFailed: outcomes.filter((o) => !o.ok).length,
    newItems: outcomes.reduce((n, o) => n + o.inserted, 0),
    errorSummary: problems.length ? problems.join('\n') : null,
  };
  finishRun(db, runId, summary, now());
  return summary;
}
