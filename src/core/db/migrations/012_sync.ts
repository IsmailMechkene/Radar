// Sync (Phase 3). Rows the user owns get a UUID, the same on every device, and triggers record
// each change in sync_changes (the change log the sync pushes from). Scraped postings, runs,
// snapshots and reminders are local only and have no triggers.
// - Synced: pipeline, outreach drafts (keyed by their pipeline row's UUID) and templates, manual
//   deadlines, programs that were added or edited, sources added by the user, user rules, and the
//   settings listed below (device-specific ones such as autostart and the backup folder are not).
// - pipeline.opportunity_key keeps the posting's dedupe key, so a row stays linked to its posting
//   on a device that scans it later and the link survives a device that has never seen it.
// - While sync_state holds 'quiet' (applying pulled rows, inserting defaults), nothing is logged.
// - Rows that already exist are logged once, so the first sync uploads them.
const uuid = /* sql */ `(lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))))`;
const now = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const loud = `NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'quiet')`;
const EPOCH = `'1970-01-01T00:00:00.000Z'`;

/** Appends (entity, key) to the change log; `from` selects the key. */
const log = (entity: string, key: string, from: string, deleted: 0 | 1) => /* sql */ `
  INSERT INTO sync_changes (entity, key, deleted, changed_at)
  SELECT '${entity}', ${key}, ${deleted}, ${now} ${from} AND ${loud}
  ON CONFLICT (entity, key) DO UPDATE
    SET deleted = excluded.deleted, changed_at = excluded.changed_at, rev = rev + 1;`;

/** UUID on insert, log on insert/update of the synced columns, tombstone on delete. */
function rowTriggers(table: string, entity: string, columns: string, when = 'true'): string {
  const whenNew = when.replaceAll('$', 'NEW');
  const whenOld = when.replaceAll('$', 'OLD');
  return /* sql */ `
CREATE TRIGGER ${table}_sync_insert AFTER INSERT ON ${table} BEGIN
  UPDATE ${table} SET uuid = ${uuid} WHERE rowid = NEW.rowid AND uuid IS NULL;
  ${log(entity, 'uuid', `FROM ${table} WHERE rowid = NEW.rowid AND (${whenNew})`, 0)}
END;
CREATE TRIGGER ${table}_sync_update AFTER UPDATE OF ${columns} ON ${table} BEGIN
  ${log(entity, 'uuid', `FROM ${table} WHERE rowid = NEW.rowid AND (${whenNew})`, 0)}
END;
CREATE TRIGGER ${table}_sync_delete AFTER DELETE ON ${table} BEGIN
  ${log(entity, 'OLD.uuid', `WHERE OLD.uuid IS NOT NULL AND (${whenOld})`, 1)}
END;
CREATE UNIQUE INDEX ${table}_uuid ON ${table} (uuid);
UPDATE ${table} SET uuid = ${uuid};`;
}

/** Synced settings (keep in step with SYNCED_SETTINGS in src/core/sync/entities.ts). */
const SETTINGS = `('timezone', 'searchMode', 'rolesOfInterest', 'targetRegions', 'remotePreference',
  'grade', 'quietHours', 'matchAlerts', 'scanIntervalHours', 'outreachDefaults')`;

export const sql = /* sql */ `
CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sync_changes (
  entity     TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  changed_at TEXT    NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entity, key)
);

ALTER TABLE pipeline ADD COLUMN uuid TEXT;
ALTER TABLE pipeline ADD COLUMN opportunity_key TEXT;
ALTER TABLE outreach_templates ADD COLUMN uuid TEXT;
ALTER TABLE manual_deadlines ADD COLUMN uuid TEXT;
ALTER TABLE programs ADD COLUMN uuid TEXT;
ALTER TABLE sources ADD COLUMN uuid TEXT;

UPDATE pipeline SET opportunity_key =
  (SELECT dedupe_key FROM opportunities o WHERE o.id = pipeline.opportunity_id);

${rowTriggers(
  'pipeline',
  'pipeline',
  `opportunity_id, program_id, org, role, status, planned_send_date, sent_at, followup1_at,
   followup2_at, contact_name, contact_url, notes`,
)}
CREATE TRIGGER pipeline_opportunity_key AFTER UPDATE OF opportunity_id ON pipeline
WHEN NEW.opportunity_id IS NOT NULL BEGIN
  UPDATE pipeline SET opportunity_key =
    (SELECT dedupe_key FROM opportunities WHERE id = NEW.opportunity_id) WHERE id = NEW.id;
END;
CREATE TRIGGER pipeline_opportunity_key_insert AFTER INSERT ON pipeline
WHEN NEW.opportunity_id IS NOT NULL BEGIN
  UPDATE pipeline SET opportunity_key =
    (SELECT dedupe_key FROM opportunities WHERE id = NEW.opportunity_id) WHERE id = NEW.id;
END;

${rowTriggers('outreach_templates', 'template', 'name, kind, subject, body')}
${rowTriggers('manual_deadlines', 'manual', 'title, org, deadline_at, url, notes')}
${rowTriggers(
  'programs',
  'program',
  `name, org, url, status, deadline_status, typical_open, typical_deadline, notes,
   expected_open_at, expected_deadline_at, edited_at, seeded`,
  '$.seeded = 0 OR $.edited_at IS NOT NULL',
)}
${rowTriggers(
  'sources',
  'source',
  'kind, name, url, config_json, access_method, tos_note, paused, added_by_user',
  '$.added_by_user = 1',
)}

CREATE TRIGGER outreach_drafts_sync_insert AFTER INSERT ON outreach_drafts BEGIN
  ${log('draft', 'p.uuid', 'FROM pipeline p WHERE p.id = NEW.pipeline_id', 0)}
END;
CREATE TRIGGER outreach_drafts_sync_update AFTER UPDATE ON outreach_drafts BEGIN
  ${log('draft', 'p.uuid', 'FROM pipeline p WHERE p.id = NEW.pipeline_id', 0)}
END;
CREATE TRIGGER outreach_drafts_sync_delete AFTER DELETE ON outreach_drafts BEGIN
  ${log('draft', 'p.uuid', 'FROM pipeline p WHERE p.id = OLD.pipeline_id', 1)}
END;

CREATE TRIGGER user_rules_sync_insert AFTER INSERT ON user_rules BEGIN
  ${log('rules', "'rules'", 'WHERE true', 0)}
END;
CREATE TRIGGER user_rules_sync_update AFTER UPDATE ON user_rules BEGIN
  ${log('rules', "'rules'", 'WHERE true', 0)}
END;
CREATE TRIGGER user_rules_sync_delete AFTER DELETE ON user_rules BEGIN
  ${log('rules', "'rules'", 'WHERE true', 1)}
END;

-- Defaults are inserted on every device, so only changes (updates) are logged.
CREATE TRIGGER settings_sync_update AFTER UPDATE OF value_json ON settings
WHEN NEW.key IN ${SETTINGS} BEGIN
  ${log('setting', 'NEW.key', 'WHERE true', 0)}
END;

-- What exists already goes up on the first sync, dated by its own timestamps where it has them
-- (untouched settings date from 1970, so a real change on another device wins over them).
INSERT INTO sync_changes (entity, key, changed_at) SELECT 'pipeline', uuid, updated_at FROM pipeline;
INSERT INTO sync_changes (entity, key, changed_at)
  SELECT 'draft', p.uuid, d.updated_at FROM outreach_drafts d JOIN pipeline p ON p.id = d.pipeline_id;
INSERT INTO sync_changes (entity, key, changed_at)
  SELECT 'template', uuid, updated_at FROM outreach_templates;
INSERT INTO sync_changes (entity, key, changed_at)
  SELECT 'manual', uuid, created_at FROM manual_deadlines;
INSERT INTO sync_changes (entity, key, changed_at)
  SELECT 'program', uuid, COALESCE(edited_at, ${EPOCH}) FROM programs
   WHERE seeded = 0 OR edited_at IS NOT NULL;
INSERT INTO sync_changes (entity, key, changed_at)
  SELECT 'source', uuid, created_at FROM sources WHERE added_by_user = 1;
INSERT INTO sync_changes (entity, key, changed_at)
  SELECT 'rules', 'rules', updated_at FROM user_rules;
INSERT INTO sync_changes (entity, key, changed_at)
  SELECT 'setting', key, ${EPOCH} FROM settings WHERE key IN ${SETTINGS};
`;
