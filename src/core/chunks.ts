// Work over every opportunity in chunks: rows are read by id, `size` at a time (never the whole
// table in memory), and each chunk is written in its own transaction. The generator yields after
// each chunk so the caller can either run it straight through or give the event loop a turn
// between chunks (the Electron main process stays responsive during a large re-score).
import type Database from 'better-sqlite3-multiple-ciphers';

export const CHUNK_SIZE = 250;

export function* inChunks<T extends { id: number }>(
  db: Database.Database,
  load: (afterId: number, limit: number) => T[],
  handle: (rows: T[]) => void,
  size = CHUNK_SIZE,
): Generator<number, void> {
  let after = 0;
  for (;;) {
    const rows = load(after, size);
    if (rows.length === 0) return;
    db.transaction(() => handle(rows))();
    after = rows[rows.length - 1]!.id;
    yield rows.length;
    if (rows.length < size) return;
  }
}

/** Runs the chunks straight through (CLI, tests). */
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
