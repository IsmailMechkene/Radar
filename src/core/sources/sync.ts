// Loads seeds/sources.json into the sources table. Idempotent: matched on (kind, name); config,
// URL and notes are refreshed; pending seeds are stored disabled. Sources not in the file
// (added by hand later) are left alone.
import type Database from 'better-sqlite3-multiple-ciphers';
import type { SeedSource } from './seeds';

export interface SyncResult {
  inserted: number;
  updated: number;
}

export function syncSeedSources(
  db: Database.Database,
  seeds: readonly SeedSource[],
  now: Date,
): SyncResult {
  const find = db.prepare('SELECT id FROM sources WHERE kind = ? AND name = ?');
  const insert = db.prepare(
    `INSERT INTO sources (kind, name, url, config_json, access_method, tos_note, enabled, created_at)
     VALUES (@kind, @name, @url, @config_json, @access_method, @tos_note, @enabled, @created_at)`,
  );
  const update = db.prepare(
    `UPDATE sources SET url = @url, config_json = @config_json, access_method = @access_method,
       tos_note = @tos_note, enabled = @enabled
     WHERE id = @id`,
  );
  return db.transaction((): SyncResult => {
    let inserted = 0;
    let updated = 0;
    for (const s of seeds) {
      const row = {
        kind: s.kind,
        name: s.name,
        url: s.url,
        // The note travels with the config so pending sources keep their explanation.
        config_json: JSON.stringify(s.note ? { ...s.config, _note: s.note } : s.config),
        access_method: s.access_method,
        tos_note: s.tos_note,
        enabled: s.status === 'active' ? 1 : 0,
      };
      const existing = find.get(s.kind, s.name) as { id: number } | undefined;
      if (existing) {
        updated += update.run({ ...row, id: existing.id }).changes;
      } else {
        insert.run({ ...row, created_at: now.toISOString() });
        inserted += 1;
      }
    }
    return { inserted, updated };
  })();
}
