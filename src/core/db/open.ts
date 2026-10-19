import Database from 'better-sqlite3-multiple-ciphers';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

export const DB_FILE_NAME = 'radar.db';

/** Path of the SQLite file inside a data directory (Electron userData, or a CLI-provided dir). */
export function resolveDbPath(dataDir: string): string {
  if (!dataDir.trim()) {
    throw new Error('resolveDbPath: dataDir must be a non-empty path');
  }
  return join(dataDir, DB_FILE_NAME);
}

/** Thrown when the key does not open the file (wrong key, or not an encrypted Radar database). */
export class WrongKeyError extends Error {
  constructor(filePath: string) {
    super(`${filePath} could not be opened with this key`);
    this.name = 'WrongKeyError';
  }
}

/**
 * Applies the data key (SQLite3 Multiple Ciphers, default cipher ChaCha20-Poly1305) and checks it
 * by reading the schema. Must run before anything else touches the file.
 */
export function applyKey(db: Database.Database, key: Buffer): void {
  db.pragma(`key='${key.toString('hex')}'`);
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_NOTADB') throw new WrongKeyError(db.name);
    throw err;
  }
}

/**
 * Opens (or creates) the SQLite file, encrypted with `key` when one is given (the app's database
 * always is; tests and in-memory copies may not be). No schema is applied here.
 */
export function openDatabase(filePath: string, key?: Buffer): Database.Database {
  const db = new Database(filePath);
  try {
    if (key) applyKey(db, key);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

const PLAIN_HEADER = 'SQLite format 3\u0000';

/** True when the file is an unencrypted SQLite database (its header is readable). */
export function isPlainDatabase(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const fd = openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(16);
    const n = readSync(fd, head, 0, 16, 0);
    return n === 16 && head.toString('latin1') === PLAIN_HEADER;
  } finally {
    closeSync(fd);
  }
}
