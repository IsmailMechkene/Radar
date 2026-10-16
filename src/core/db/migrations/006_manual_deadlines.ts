// Manual deadlines (SPEC section 9: "add manual deadline") and reminders for them. SQLite cannot
// change a CHECK constraint in place, so the reminders table is rebuilt with 'manual' allowed.
export const sql = /* sql */ `
CREATE TABLE manual_deadlines (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  org         TEXT,
  deadline_at TEXT NOT NULL,
  url         TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE reminders_new (
  id            INTEGER PRIMARY KEY,
  target_type   TEXT    NOT NULL CHECK (target_type IN ('opportunity', 'program', 'pipeline', 'manual')),
  target_id     INTEGER NOT NULL,
  due_at        TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  fired_at      TEXT,
  snoozed_until TEXT,
  done_at       TEXT
);
INSERT INTO reminders_new (id, target_type, target_id, due_at, kind, fired_at, snoozed_until, done_at)
  SELECT id, target_type, target_id, due_at, kind, fired_at, snoozed_until, done_at FROM reminders;
DROP TABLE reminders;
ALTER TABLE reminders_new RENAME TO reminders;
CREATE INDEX reminders_due ON reminders (fired_at, due_at);
CREATE UNIQUE INDEX reminders_unique ON reminders (target_type, target_id, kind, due_at);
`;
