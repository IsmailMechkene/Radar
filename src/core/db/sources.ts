import type Database from 'better-sqlite3-multiple-ciphers';
import { sourceInputSchema, sourceRowSchema, type SourceInput, type SourceRow } from './schemas';

export function insertSource(db: Database.Database, input: SourceInput, now: Date): SourceRow {
  const s = sourceInputSchema.parse(input);
  const row = db
    .prepare(
      `INSERT INTO sources (kind, name, url, config_json, access_method, tos_note, enabled, created_at)
       VALUES (@kind, @name, @url, @config_json, @access_method, @tos_note, @enabled, @created_at)
       RETURNING *`,
    )
    .get({
      kind: s.kind,
      name: s.name,
      url: s.url,
      config_json: JSON.stringify(s.config),
      access_method: s.access_method,
      tos_note: s.tos_note,
      enabled: s.enabled ? 1 : 0,
      created_at: now.toISOString(),
    });
  return sourceRowSchema.parse(row);
}

export function getSource(db: Database.Database, id: number): SourceRow | undefined {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  return row === undefined ? undefined : sourceRowSchema.parse(row);
}

export function listSources(db: Database.Database): SourceRow[] {
  return db
    .prepare('SELECT * FROM sources ORDER BY id')
    .all()
    .map((row) => sourceRowSchema.parse(row));
}
