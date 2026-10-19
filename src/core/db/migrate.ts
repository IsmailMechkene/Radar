import type Database from 'better-sqlite3-multiple-ciphers';
import { migrations as defaultMigrations, type Migration } from './migrations';

export interface MigrateResult {
  from: number;
  to: number;
  applied: number[];
}

export function currentSchemaVersion(db: Database.Database): number {
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get();
  if (!table) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as {
    v: number | null;
  };
  return row.v ?? 0;
}

function assertSequential(list: readonly Migration[]): void {
  list.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `Migrations must be numbered 1..n without gaps; found ${m.version} at #${i + 1}`,
      );
    }
  });
}

/** Applies pending migrations in order, each in its own transaction. Safe to call on every start. */
export function migrate(
  db: Database.Database,
  now: () => Date = () => new Date(),
  list: readonly Migration[] = defaultMigrations,
): MigrateResult {
  assertSequential(list);

  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const from = currentSchemaVersion(db);
  const latest = list.length;
  if (from > latest) {
    throw new Error(
      `Database schema version ${from} is newer than this app supports (${latest}). Update Radar.`,
    );
  }

  const record = db.prepare(
    'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)',
  );
  const applied: number[] = [];
  for (const m of list.slice(from)) {
    try {
      db.transaction(() => {
        db.exec(m.sql);
        record.run(m.version, m.name, now().toISOString());
      })();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${message}`, { cause: err });
    }
    applied.push(m.version);
  }

  return { from, to: currentSchemaVersion(db), applied };
}
