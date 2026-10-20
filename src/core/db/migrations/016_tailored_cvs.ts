// Radar Copilot tailored CVs: one per posting, keyed by the posting's dedupe key like reviews, and
// synced as entity 'cv'. The PDF is made from cv_json on demand and never stored.
const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const loud = `NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'quiet')`;

const log = (key: string, deleted: 0 | 1) => /* sql */ `
  INSERT INTO sync_changes (entity, key, deleted, changed_at)
  SELECT 'cv', ${key}, ${deleted}, ${now} WHERE ${loud}
  ON CONFLICT (entity, key) DO UPDATE
    SET deleted = excluded.deleted, changed_at = excluded.changed_at, rev = rev + 1;`;

export const sql = /* sql */ `
CREATE TABLE copilot_cvs (
  opportunity_key TEXT PRIMARY KEY,
  cv_json         TEXT NOT NULL,
  model           TEXT NOT NULL,
  cost_usd        REAL,
  created_at      TEXT NOT NULL
);

CREATE TRIGGER copilot_cvs_sync_insert AFTER INSERT ON copilot_cvs BEGIN
  ${log('NEW.opportunity_key', 0)}
END;
CREATE TRIGGER copilot_cvs_sync_update AFTER UPDATE ON copilot_cvs BEGIN
  ${log('NEW.opportunity_key', 0)}
END;
CREATE TRIGGER copilot_cvs_sync_delete AFTER DELETE ON copilot_cvs BEGIN
  ${log('OLD.opportunity_key', 1)}
END;
`;
