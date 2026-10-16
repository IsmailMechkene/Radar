import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_FILE_NAME, openDatabase, resolveDbPath } from '../src/core/db/open';

describe('core/db/open (runs under plain Node, no Electron)', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('resolves the DB path inside the data dir and rejects an empty dir', () => {
    expect(resolveDbPath(join('some', 'dir'))).toBe(join('some', 'dir', DB_FILE_NAME));
    expect(() => resolveDbPath('  ')).toThrow();
  });

  it('opens a SQLite file with WAL enabled', () => {
    dir = mkdtempSync(join(tmpdir(), 'radar-test-'));
    const db = openDatabase(resolveDbPath(dir));
    try {
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    } finally {
      db.close();
    }
  });
});
