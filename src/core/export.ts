// "Export JSON / Export CSV" (SPEC section 8: export of everything). Every user table, as stored.
// Page snapshots export without their full page text (it is only a change-detection baseline).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3-multiple-ciphers';

/** Tables in export order, with the columns left out (if any). */
export const EXPORT_TABLES: readonly { name: string; omit?: readonly string[] }[] = [
  { name: 'opportunities' },
  { name: 'opportunity_sources' },
  { name: 'pipeline' },
  { name: 'programs' },
  { name: 'manual_deadlines' },
  { name: 'reminders' },
  { name: 'alerts' },
  { name: 'outreach_templates' },
  { name: 'outreach_drafts' },
  { name: 'sources' },
  { name: 'runs' },
  { name: 'settings' },
  { name: 'user_rules' },
  { name: 'page_snapshots', omit: ['text_excerpt'] },
];

export type Row = Record<string, unknown>;

export function readTables(db: Database.Database): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const t of EXPORT_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${t.name} ORDER BY rowid`).all() as Row[];
    out[t.name] = t.omit
      ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !t.omit!.includes(k))))
      : rows;
  }
  return out;
}

export function exportJson(db: Database.Database, now: Date): string {
  const version = db.prepare('SELECT MAX(version) FROM schema_version').pluck().get() as
    number | null;
  return (
    JSON.stringify(
      {
        app: 'Radar',
        exported_at: now.toISOString(),
        schema_version: version,
        tables: readTables(db),
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * One CSV value. Quotes when needed (comma, quote, newline). A text starting with = + - @ (or a
 * tab / carriage return) is prefixed with ' so spreadsheet apps never run it as a formula.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a header row (union of keys, first-seen order), CRLF, UTF-8 BOM for Excel. */
export function toCsv(rows: readonly Row[], columns?: readonly string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [
    cols.map(csvCell).join(','),
    ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Writes one CSV per table into `folder` (created). Returns the files written. */
export function exportCsv(db: Database.Database, folder: string): string[] {
  mkdirSync(folder, { recursive: true });
  const files: string[] = [];
  for (const [name, rows] of Object.entries(readTables(db))) {
    const columns = rows.length
      ? undefined
      : (db.prepare(`SELECT name FROM pragma_table_info(?)`).pluck().all(name) as string[]);
    const file = join(folder, `${name}.csv`);
    writeFileSync(file, toCsv(rows, columns), 'utf8');
    files.push(file);
  }
  return files;
}
