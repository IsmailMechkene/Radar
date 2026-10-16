import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase, resolveDbPath } from '../src/core/db/open';

export const fixedClock = (iso: string) => () => new Date(iso);

/** A fresh SQLite file in a temp dir. Call cleanup() in afterEach. */
export function tempDb(): { db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'radar-test-'));
  const db = openDatabase(resolveDbPath(dir));
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
