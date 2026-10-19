import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupDatabase,
  backupFileName,
  hasBackupFor,
  KEEP_BACKUPS,
  listBackups,
} from '../src/core/backup';
import { migrate } from '../src/core/db/migrate';
import { createPipelineRow } from '../src/core/db/pipeline';
import { csvCell, exportCsv, exportJson, EXPORT_TABLES, toCsv } from '../src/core/export';
import { seedDefaultSettings } from '../src/core/settings/store';
import { lastBackupLine, shortPath } from '../src/renderer/src/lib/data';
import { tempDb } from './helpers';

const TZ = 'Africa/Tunis';
const NOW = new Date('2026-10-16T08:00:00.000Z');

describe('backups', () => {
  let t: ReturnType<typeof tempDb>;
  let folder: string;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    seedDefaultSettings(t.db);
    folder = mkdtempSync(join(tmpdir(), 'radar-backups-'));
  });
  afterEach(() => {
    t.cleanup();
    rmSync(folder, { recursive: true, force: true });
  });

  it('names backups by local day', () => {
    // 23:30Z on Oct 16 is already Oct 17 in Tunis.
    expect(backupFileName(new Date('2026-10-16T23:30:00Z'), TZ)).toBe('radar-2026-10-17.db');
    expect(backupFileName(new Date('2026-10-16T23:30:00Z'), 'UTC')).toBe('radar-2026-10-16.db');
  });

  it('writes a consistent, openable copy and replaces today’s on a second run', async () => {
    createPipelineRow(t.db, { org: 'Weaviate' }, TZ, NOW);
    expect(hasBackupFor(folder, NOW, TZ)).toBe(false);
    const r = await backupDatabase(t.db, folder, NOW, TZ);
    expect(r.file).toBe(join(folder, 'radar-2026-10-16.db'));
    expect(hasBackupFor(folder, NOW, TZ)).toBe(true);
    const copy = new Database(r.file, { readonly: true });
    expect(copy.prepare('SELECT org FROM pipeline').pluck().get()).toBe('Weaviate');
    copy.close();
    createPipelineRow(t.db, { org: 'DeepL' }, TZ, NOW);
    await backupDatabase(t.db, folder, NOW, TZ);
    expect(listBackups(folder)).toHaveLength(1);
    const again = new Database(r.file, { readonly: true });
    expect(again.prepare('SELECT COUNT(*) FROM pipeline').pluck().get()).toBe(2);
    again.close();
    expect(readdirSync(folder).some((f) => f.endsWith('.part'))).toBe(false);
  });

  it(`keeps the newest ${KEEP_BACKUPS} and ignores other files`, async () => {
    for (let d = 1; d <= 16; d++)
      writeFileSync(join(folder, `radar-2026-09-${String(d).padStart(2, '0')}.db`), 'x');
    writeFileSync(join(folder, 'notes.txt'), 'mine');
    const r = await backupDatabase(t.db, folder, NOW, TZ);
    const left = listBackups(folder).map((b) => b.date);
    expect(left).toHaveLength(KEEP_BACKUPS);
    expect(left[0]).toBe('2026-10-16');
    expect(left.at(-1)).toBe('2026-09-04');
    expect(r.pruned).toHaveLength(3);
    expect(existsSync(join(folder, 'notes.txt'))).toBe(true);
  });

  it('a missing folder lists nothing and is created on backup', async () => {
    const nested = join(folder, 'a', 'b');
    expect(listBackups(nested)).toEqual([]);
    await backupDatabase(t.db, nested, NOW, TZ);
    expect(listBackups(nested)).toHaveLength(1);
  });
});

describe('export', () => {
  let t: ReturnType<typeof tempDb>;
  let folder: string;
  beforeEach(() => {
    t = tempDb();
    migrate(t.db);
    seedDefaultSettings(t.db);
    folder = mkdtempSync(join(tmpdir(), 'radar-export-'));
  });
  afterEach(() => {
    t.cleanup();
    rmSync(folder, { recursive: true, force: true });
  });

  it('CSV cells: quotes, newlines, and no spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, "b"')).toBe('"a, ""b"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+33 1 23')).toBe("'+33 1 23");
    expect(csvCell(-25)).toBe('-25');
    expect(csvCell(null)).toBe('');
    expect(
      toCsv([
        { a: 1, b: 'x' },
        { a: 2, c: true },
      ]),
    ).toBe('\uFEFFa,b,c\r\n1,x,\r\n2,,true\r\n');
  });

  it('JSON has every table and the schema version; page text is left out', () => {
    createPipelineRow(t.db, { org: 'Weaviate', notes: 'Go client' }, TZ, NOW);
    const json = JSON.parse(exportJson(t.db, NOW)) as {
      schema_version: number;
      tables: Record<string, unknown[]>;
    };
    expect(json.schema_version).toBeGreaterThanOrEqual(10);
    expect(Object.keys(json.tables)).toEqual(EXPORT_TABLES.map((x) => x.name));
    expect(json.tables['pipeline']).toEqual([
      expect.objectContaining({ org: 'Weaviate', notes: 'Go client' }),
    ]);
    expect((json.tables['settings'] as unknown[]).length).toBeGreaterThan(5);
  });

  it('CSV writes one file per table, headers even when empty', () => {
    createPipelineRow(t.db, { org: 'Weaviate' }, TZ, NOW);
    const files = exportCsv(t.db, join(folder, 'radar-export'));
    expect(files).toHaveLength(EXPORT_TABLES.length);
    const pipeline = readFileSync(join(folder, 'radar-export', 'pipeline.csv'), 'utf8');
    expect(pipeline.split('\r\n')[0]).toContain('org');
    expect(pipeline).toContain('Weaviate');
    const alerts = readFileSync(join(folder, 'radar-export', 'alerts.csv'), 'utf8');
    expect(alerts.split('\r\n')[0]).toContain('title'); // empty table, header from the schema
  });
});

describe('settings data line', () => {
  it('shortens long paths and describes the last backup', () => {
    expect(shortPath('C:\\Users\\MSI\\AppData\\Roaming\\radar\\Backups', 30)).toBe(
      '…\\Roaming\\radar\\Backups',
    );
    expect(shortPath('/home/me/Backups')).toBe('/home/me/Backups');
    const info = {
      folder: 'x',
      chosen: false,
      count: 3,
      last: { file: 'f', date: '2026-10-16', size: 1, modifiedAt: '2026-10-16T08:12:00.000Z' },
    };
    expect(lastBackupLine(info, NOW, TZ)).toBe('last backup today 09:12 · 3 kept');
    expect(lastBackupLine({ ...info, last: null, count: 0 }, NOW, TZ)).toMatch(/no backup yet/);
  });
});
