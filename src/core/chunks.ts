// Work over opportunities in chunks: rows are read by id, `size` at a time (never the whole
// table in memory). Each chunk is computed outside any transaction and only its writes run in a
// short IMMEDIATE one, so a pass on another connection (the passes worker) never holds the write
// lock while it parses. The generator yields after each chunk so the caller can either run it
// straight through or give the event loop a turn between chunks.
import type Database from 'better-sqlite3-multiple-ciphers';

export const CHUNK_SIZE = 250;

/**
 * Which postings a pass looks at: every open one, or only those changed since the last pass
 * (see migration 13). Closed postings are never processed: nobody sees them, and they only grow.
 */
export type PassScope = 'all' | 'changed';

/** SQL condition (opportunities aliased `o`) for a scope. */
export function scopeCondition(scope: PassScope): string {
  return scope === 'changed'
    ? 'o.closed_at IS NULL AND o.scored_revision < o.revision'
    : 'o.closed_at IS NULL';
}

export function* inChunks<T extends { id: number }, R>(
  db: Database.Database,
  load: (afterId: number, limit: number) => T[],
  compute: (rows: T[]) => R,
  write: (result: R) => void,
  size = CHUNK_SIZE,
): Generator<number, void> {
  const commit = db.transaction(write);
  let after = 0;
  for (;;) {
    const rows = load(after, size);
    if (rows.length === 0) return;
    commit.immediate(compute(rows));
    after = rows[rows.length - 1]!.id;
    yield rows.length;
    if (rows.length < size) return;
  }
}

/** Runs the chunks straight through (CLI, tests, the passes worker). */
export function drain(chunks: Generator<number, void>): void {
  for (const _ of chunks) {
    // each chunk already ran
  }
}

/** Runs the chunks, awaiting `pause` between them (e.g. setImmediate in the main process). */
export async function drainAsync(
  chunks: Generator<number, void>,
  pause: () => Promise<void>,
): Promise<void> {
  for (const _ of chunks) await pause();
}
