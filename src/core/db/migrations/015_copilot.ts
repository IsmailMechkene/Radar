// Radar Copilot (opt-in): one AI review per posting, keyed by the posting's dedupe key so it
// follows the account (entity 'review') and stays linked on a device that scans the posting later.
// The master CV becomes a synced setting: the settings trigger is recreated with it in the list.
const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const loud = `NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'quiet')`;
const EPOCH = `'1970-01-01T00:00:00.000Z'`;

const log = (entity: string, key: string, from: string, deleted: 0 | 1) => /* sql */ `
  INSERT INTO sync_changes (entity, key, deleted, changed_at)
  SELECT '${entity}', ${key}, ${deleted}, ${now} ${from} AND ${loud}
  ON CONFLICT (entity, key) DO UPDATE
    SET deleted = excluded.deleted, changed_at = excluded.changed_at, rev = rev + 1;`;

/** Synced settings (keep in step with SYNCED_SETTINGS in src/core/sync/entities.ts). */
const SETTINGS = `('timezone', 'searchMode', 'rolesOfInterest', 'targetRegions', 'remotePreference',
  'grade', 'quietHours', 'matchAlerts', 'scanIntervalHours', 'outreachDefaults', 'masterCv')`;

export const sql = /* sql */ `
CREATE TABLE copilot_reviews (
  opportunity_key TEXT PRIMARY KEY,
  -- 0 to 5 (one decimal); the A-F grade is derived from it.
  score           REAL NOT NULL CHECK (score >= 0 AND score <= 5),
  review_json     TEXT NOT NULL,
  model           TEXT NOT NULL,
  cost_usd        REAL,
  reviewed_at     TEXT NOT NULL
);

CREATE TRIGGER copilot_reviews_sync_insert AFTER INSERT ON copilot_reviews BEGIN
  ${log('review', 'NEW.opportunity_key', 'WHERE true', 0)}
END;
CREATE TRIGGER copilot_reviews_sync_update AFTER UPDATE ON copilot_reviews BEGIN
  ${log('review', 'NEW.opportunity_key', 'WHERE true', 0)}
END;
CREATE TRIGGER copilot_reviews_sync_delete AFTER DELETE ON copilot_reviews BEGIN
  ${log('review', 'OLD.opportunity_key', 'WHERE true', 1)}
END;

DROP TRIGGER settings_sync_update;
CREATE TRIGGER settings_sync_update AFTER UPDATE OF value_json ON settings
WHEN NEW.key IN ${SETTINGS} BEGIN
  ${log('setting', 'NEW.key', 'WHERE true', 0)}
END;
INSERT INTO sync_changes (entity, key, changed_at)
  SELECT 'setting', key, ${EPOCH} FROM settings WHERE key = 'masterCv'
  ON CONFLICT (entity, key) DO NOTHING;
`;
