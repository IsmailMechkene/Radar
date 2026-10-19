// Local sync bookkeeping: the change log the triggers fill (sync_changes, migration 12) and small
// values in sync_state (pull cursor, device id, the account's sync root).
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';

export type StateKey = 'cursor' | 'device' | 'root' | 'synced_at';

export function getState(db: Database.Database, key: StateKey): string | null {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function setState(db: Database.Database, key: StateKey, value: string | null): void {
  if (value === null) db.prepare('DELETE FROM sync_state WHERE key = ?').run(key);
  else
    db.prepare(
      'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
}

/** This database's device id (records it pushed come back on pull and are skipped). */
export function deviceId(db: Database.Database): string {
  const id = getState(db, 'device');
  if (id) return id;
  const next = randomUUID();
  setState(db, 'device', next);
  return next;
}

/**
 * Runs `fn` in a transaction without logging changes: rows pulled from the account, or defaults
 * every device inserts the same way.
 */
export function quietly<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(() => {
    const outer = db.prepare("SELECT 1 FROM sync_state WHERE key = 'quiet'").get() !== undefined;
    if (!outer) db.prepare("INSERT INTO sync_state (key, value) VALUES ('quiet', '1')").run();
    try {
      return fn();
    } finally {
      if (!outer) db.prepare("DELETE FROM sync_state WHERE key = 'quiet'").run();
    }
  })();
}

const changeSchema = z.object({
  entity: z.string(),
  key: z.string(),
  deleted: z.union([z.literal(0), z.literal(1)]).transform((d) => d === 1),
  changed_at: z.string(),
  rev: z.int(),
});
export type Change = z.output<typeof changeSchema>;

export function pendingChanges(db: Database.Database): Change[] {
  return db
    .prepare('SELECT entity, key, deleted, changed_at, rev FROM sync_changes')
    .all()
    .map((r) => changeSchema.parse(r));
}

export function pendingChange(db: Database.Database, entity: string, key: string): Change | null {
  const row = db
    .prepare(
      'SELECT entity, key, deleted, changed_at, rev FROM sync_changes WHERE entity = ? AND key = ?',
    )
    .get(entity, key);
  return row === undefined ? null : changeSchema.parse(row);
}

export function pendingCount(db: Database.Database): number {
  return db.prepare('SELECT COUNT(*) FROM sync_changes').pluck().get() as number;
}

/** Removes pushed changes, unless the row changed again meanwhile (its rev moved on). */
export function clearChanges(db: Database.Database, changes: readonly Change[]): void {
  const del = db.prepare('DELETE FROM sync_changes WHERE entity = ? AND key = ? AND rev = ?');
  db.transaction(() => {
    for (const c of changes) del.run(c.entity, c.key, c.rev);
  })();
}

export function dropChange(db: Database.Database, entity: string, key: string): void {
  db.prepare('DELETE FROM sync_changes WHERE entity = ? AND key = ?').run(entity, key);
}

/** Queues a change by hand (merging two copies of one row), dated `at`. */
export function queueChange(
  db: Database.Database,
  entity: string,
  key: string,
  deleted: boolean,
  at: string,
): void {
  db.prepare(
    `INSERT INTO sync_changes (entity, key, deleted, changed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (entity, key) DO UPDATE
       SET deleted = excluded.deleted, changed_at = excluded.changed_at, rev = rev + 1`,
  ).run(entity, key, deleted ? 1 : 0, at);
}
