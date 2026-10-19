import type Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentSchemaVersion, migrate } from '../src/core/db/migrate';
import { migrations } from '../src/core/db/migrations';
import { fixedClock, tempDb } from './helpers';

const clock = fixedClock('2026-10-16T08:00:00.000Z');

function schemaSnapshot(db: Database.Database) {
  return db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
}

describe('migrations', () => {
  let t: ReturnType<typeof tempDb>;
  beforeEach(() => {
    t = tempDb();
  });
  afterEach(() => t.cleanup());

  it('brings a fresh database to the latest version with every SPEC table', () => {
    const result = migrate(t.db, clock);
    expect(result).toEqual({
      from: 0,
      to: migrations.length,
      applied: migrations.map((m) => m.version),
    });

    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all();
    expect(tables).toEqual(
      expect.arrayContaining([
        'sources',
        'opportunities',
        'opportunity_sources',
        'programs',
        'pipeline',
        'reminders',
        'page_snapshots',
        'runs',
        'settings',
        'schema_version',
      ]),
    );
    expect(t.db.prepare('SELECT applied_at FROM schema_version').pluck().get()).toBe(
      '2026-10-16T08:00:00.000Z',
    );
  });

  it('is idempotent: running twice changes nothing', () => {
    migrate(t.db, clock);
    const before = schemaSnapshot(t.db);
    const versionsBefore = t.db.prepare('SELECT * FROM schema_version').all();

    const second = migrate(t.db, clock);

    expect(second.applied).toEqual([]);
    expect(second.from).toBe(second.to);
    expect(schemaSnapshot(t.db)).toEqual(before);
    expect(t.db.prepare('SELECT * FROM schema_version').all()).toEqual(versionsBefore);
  });

  it('rolls back a failing migration and reports it', () => {
    const list = [
      { version: 1, name: 'ok', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY);' },
      { version: 2, name: 'broken', sql: 'CREATE TABLE b (id INTEGER); NOT VALID SQL;' },
    ];
    expect(() => migrate(t.db, clock, list)).toThrow(/Migration 2 \(broken\) failed/);
    expect(currentSchemaVersion(t.db)).toBe(1);
    expect(t.db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get()).toBeUndefined();
  });

  it('refuses a database newer than the app', () => {
    migrate(t.db, clock);
    t.db
      .prepare("INSERT INTO schema_version VALUES (99, 'future', '2030-01-01T00:00:00.000Z')")
      .run();
    expect(() => migrate(t.db, clock)).toThrow(/newer than this app supports/);
  });
});
