// Turns an existing unencrypted radar.db into an encrypted one, and finishes a move that a crash
// interrupted. The plain file is deleted only after the encrypted copy has been reopened with the
// key and checked table by table against it.
//   radar.db (plain) -> radar.db.encrypting (copy, then rekeyed) -> checked
//   radar.db -> radar.db.plain, radar.db.encrypting -> radar.db, then radar.db.plain is deleted.
import { createHash } from 'node:crypto';
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import Database from 'better-sqlite3-multiple-ciphers';
import { isPlainDatabase, openDatabase, resolveDbPath } from '../db/open';

const SIDECARS = ['-wal', '-shm', '-journal'];

function removeWithSidecars(path: string): void {
  for (const suffix of ['', ...SIDECARS]) rmSync(path + suffix, { force: true });
}

/** A WAL file left with content after closing would mean writes not in the main file. */
function assertNoPendingWal(path: string): void {
  const wal = `${path}-wal`;
  if (existsSync(wal) && statSync(wal).size > 0) {
    throw new Error(`${wal} still holds changes; close other Radar processes and try again`);
  }
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

/** Table name -> row count and a hash of every row, in storage order. */
export function tableFingerprints(db: Database.Database): Map<string, string> {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_stat%' ORDER BY name",
    )
    .pluck()
    .all() as string[];
  const out = new Map<string, string>();
  for (const name of tables) {
    const hash = createHash('sha256');
    let rows = 0;
    const stmt = db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).raw();
    for (const row of stmt.iterate()) {
      hash.update(JSON.stringify(row));
      hash.update('\n');
      rows++;
    }
    out.set(name, `${rows}:${hash.digest('hex')}`);
  }
  return out;
}

function sameFingerprints(a: Map<string, string>, b: Map<string, string>): string | null {
  for (const [name, fp] of a) {
    if (b.get(name) !== fp) return `table ${name} differs after encryption`;
  }
  for (const name of b.keys()) if (!a.has(name)) return `table ${name} appeared after encryption`;
  return null;
}

async function encryptCopy(plainPath: string, tempPath: string, key: Buffer): Promise<void> {
  removeWithSidecars(tempPath);
  const plain = new Database(plainPath, { fileMustExist: true });
  try {
    plain.pragma('wal_checkpoint(TRUNCATE)');
    await plain.backup(tempPath);
  } finally {
    plain.close();
  }
  assertNoPendingWal(plainPath);

  // SQLite3 Multiple Ciphers cannot encrypt a plain file in WAL mode: rekey in rollback mode.
  const copy = new Database(tempPath, { fileMustExist: true });
  try {
    copy.pragma('journal_mode = DELETE');
    copy.pragma(`rekey='${key.toString('hex')}'`);
    copy.pragma('journal_mode = WAL');
  } finally {
    copy.close();
  }
  assertNoPendingWal(tempPath);
}

function verifyCopy(plainPath: string, tempPath: string, key: Buffer): void {
  if (isPlainDatabase(tempPath)) throw new Error('the encrypted copy is not encrypted');
  const enc = openDatabase(tempPath, key);
  // Not read-only: a read-only connection leaves an empty -wal behind, which would end up next to
  // the encrypted file after the swap.
  const plain = new Database(plainPath, { fileMustExist: true });
  try {
    const check = enc.pragma('integrity_check', { simple: true });
    if (check !== 'ok') throw new Error(`integrity check of the encrypted copy: ${String(check)}`);
    const v1 = plain.pragma('user_version', { simple: true });
    const v2 = enc.pragma('user_version', { simple: true });
    if (v1 !== v2) throw new Error(`schema version differs (${String(v1)} vs ${String(v2)})`);
    const diff = sameFingerprints(tableFingerprints(plain), tableFingerprints(enc));
    if (diff) throw new Error(diff);
  } finally {
    plain.close();
    enc.close();
  }
  assertNoPendingWal(plainPath);
  assertNoPendingWal(tempPath);
}

export interface PrepareResult {
  /** A plain database was encrypted now. */
  encrypted: boolean;
  /** A leftover plain copy from an interrupted run was deleted. */
  cleanedUp: boolean;
}

/**
 * Makes sure `<dataDir>/radar.db` is encrypted with `key` (when it exists), resuming or finishing
 * an interrupted encryption. A failure leaves the original plain file in place.
 */
export async function prepareEncryptedDatabase(
  dataDir: string,
  key: Buffer,
): Promise<PrepareResult> {
  const dbPath = resolveDbPath(dataDir);
  const tempPath = `${dbPath}.encrypting`;
  const oldPath = `${dbPath}.plain`;
  const result: PrepareResult = { encrypted: false, cleanedUp: false };

  if (existsSync(oldPath)) {
    if (!existsSync(dbPath)) {
      // Stopped between the two renames: the plain file is the only copy. Start over from it.
      renameSync(oldPath, dbPath);
    } else if (!isPlainDatabase(dbPath)) {
      // Stopped after the swap: delete the plain copy once the encrypted file opens.
      openDatabase(dbPath, key).close();
      removeWithSidecars(oldPath);
      result.cleanedUp = true;
    } else {
      throw new Error(
        `${dbPath} and ${oldPath} are both unencrypted; keep one and remove the other`,
      );
    }
  }
  removeWithSidecars(tempPath); // an unfinished copy is rebuilt from the plain file

  if (!isPlainDatabase(dbPath)) return result;

  try {
    await encryptCopy(dbPath, tempPath, key);
    verifyCopy(dbPath, tempPath, key);
  } catch (err) {
    removeWithSidecars(tempPath);
    throw new Error(`Encrypting ${dbPath} failed; your data was not changed`, { cause: err });
  }
  renameSync(dbPath, oldPath);
  renameSync(tempPath, dbPath);
  removeWithSidecars(oldPath);
  result.encrypted = true;
  return result;
}
