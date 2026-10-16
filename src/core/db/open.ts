import Database from 'better-sqlite3';
import { join } from 'node:path';

export const DB_FILE_NAME = 'radar.db';

/** Path of the SQLite file inside a data directory (Electron userData, or a CLI-provided dir). */
export function resolveDbPath(dataDir: string): string {
  if (!dataDir.trim()) {
    throw new Error('resolveDbPath: dataDir must be a non-empty path');
  }
  return join(dataDir, DB_FILE_NAME);
}

/** Opens (or creates) the SQLite file. No schema is applied here. */
export function openDatabase(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
