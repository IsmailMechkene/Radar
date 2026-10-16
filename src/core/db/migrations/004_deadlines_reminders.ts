// Deadlines, programs, page-change alerts and reminders (M5, SPEC section 7).
// - opportunities.deadline_note: why a parsed deadline was not trusted (low confidence).
// - programs: own status (they are not scored), the expected window of the next cycle as UTC
//   instants, the watched page (a source of kind 'page') and a unique name for seed sync.
// - reminders: mark-done, and one row per (target, kind, due date) so planning is idempotent.
// - alerts: "page changed, review" and similar, with a short text diff.
export const sql = /* sql */ `
ALTER TABLE opportunities ADD COLUMN deadline_note TEXT;

ALTER TABLE programs ADD COLUMN status TEXT NOT NULL DEFAULT 'watching'
  CHECK (status IN ('watching', 'open', 'applied', 'closed', 'not_applicable'));
ALTER TABLE programs ADD COLUMN expected_open_at TEXT;
ALTER TABLE programs ADD COLUMN expected_deadline_at TEXT;
ALTER TABLE programs ADD COLUMN source_id INTEGER REFERENCES sources (id) ON DELETE SET NULL;
CREATE UNIQUE INDEX programs_name ON programs (name);

ALTER TABLE reminders ADD COLUMN done_at TEXT;
CREATE UNIQUE INDEX reminders_unique ON reminders (target_type, target_id, kind, due_at);

CREATE TABLE alerts (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL CHECK (kind IN ('page_changed')),
  source_id   INTEGER REFERENCES sources (id) ON DELETE CASCADE,
  program_id  INTEGER REFERENCES programs (id) ON DELETE SET NULL,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  notified_at TEXT,
  seen_at     TEXT
);
CREATE INDEX alerts_notified ON alerts (notified_at, created_at);
`;
