// Daily SQLite backups (SPEC section 8): a consistent copy of the database through VACUUM INTO,
// one file per local day, the last 14 kept. No Electron: the folder is passed in.
// VACUUM INTO writes the copy encrypted with the same key as the open database (the backup API
// refuses an encrypted source), so a backup opens with the same password as radar.db.
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3-multiple-ciphers';
import { zonedParts } from './time';

export const KEEP_BACKUPS = 14;
const NAME_RE = /^radar-(\d{4}-\d{2}-\d{2})\.db$/;

/** "radar-2026-10-16.db" for the user's local day. */
export function backupFileName(now: Date, timeZone: string): string {
  const p = zonedParts(now, timeZone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `radar-${p.year}-${two(p.month)}-${two(p.day)}.db`;
}

export interface BackupFile {
  file: string;
  /** Local day, "2026-10-16". */
  date: string;
  size: number;
  modifiedAt: string;
}

/** Radar's backups in a folder, newest first. Other files are ignored. A missing folder is empty. */
export function listBackups(folder: string): BackupFile[] {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return names
    .map((name) => ({ name, m: NAME_RE.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .map(({ name, m }) => {
      const st = statSync(join(folder, name));
      return {
        file: join(folder, name),
        date: m[1]!,
        size: st.size,
        modifiedAt: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function hasBackupFor(folder: string, now: Date, timeZone: string): boolean {
  const name = backupFileName(now, timeZone);
  return listBackups(folder).some((b) => b.file.endsWith(name));
}

export interface BackupResult {
  file: string;
  size: number;
  /** Older backups removed to keep the last KEEP_BACKUPS. */
  pruned: string[];
}

/**
 * Copies the database into `folder` as today's backup (replacing an earlier one from today),
 * then keeps only the newest KEEP_BACKUPS. Written to a temporary name first, so a failed backup
 * never leaves a half-written file under a real name.
 */
export async function backupDatabase(
  db: Database.Database,
  folder: string,
  now: Date,
  timeZone: string,
): Promise<BackupResult> {
  mkdirSync(folder, { recursive: true });
  const name = backupFileName(now, timeZone);
  const target = join(folder, name);
  const temp = join(folder, `${name}.part`);
  rmSync(temp, { force: true });
  try {
    db.prepare('VACUUM INTO ?').run(temp);
    renameSync(temp, target);
  } catch (err) {
    rmSync(temp, { force: true });
    throw err;
  }
  const pruned: string[] = [];
  for (const old of listBackups(folder).slice(KEEP_BACKUPS)) {
    rmSync(old.file, { force: true });
    pruned.push(old.file);
  }
  return { file: target, size: statSync(target).size, pruned };
}
