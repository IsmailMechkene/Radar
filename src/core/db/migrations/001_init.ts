// Initial schema: SPEC.md section 4, plus opportunity_type, language, opportunity_sources,
// sources.access_method and sources.tos_note. Timestamps are UTC ISO-8601 strings.
export const sql = /* sql */ `
CREATE TABLE sources (
  id                INTEGER PRIMARY KEY,
  kind              TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  url               TEXT,
  config_json       TEXT    NOT NULL DEFAULT '{}',
  access_method     TEXT    NOT NULL
                    CHECK (access_method IN ('api', 'rss', 'public_html', 'email_alert', 'manual')),
  tos_note          TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_ok_at        TEXT,
  last_error        TEXT,
  consecutive_empty INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL
);

CREATE TABLE opportunities (
  id                   INTEGER PRIMARY KEY,
  dedupe_key           TEXT    NOT NULL UNIQUE,
  source_id            INTEGER NOT NULL REFERENCES sources (id),
  org                  TEXT    NOT NULL,
  title                TEXT    NOT NULL,
  location             TEXT,
  remote_type          TEXT    NOT NULL DEFAULT 'unknown'
                       CHECK (remote_type IN ('onsite', 'hybrid', 'remote', 'unknown')),
  opportunity_type     TEXT    NOT NULL
                       CHECK (opportunity_type IN ('internship', 'pfe', 'junior', 'fulltime', 'program')),
  language             TEXT    NOT NULL DEFAULT 'unknown'
                       CHECK (language IN ('en', 'fr', 'other', 'unknown')),
  url                  TEXT    NOT NULL,
  apply_url            TEXT,
  description          TEXT,
  posted_at            TEXT,
  deadline_at          TEXT,
  deadline_status      TEXT    NOT NULL DEFAULT 'unknown'
                       CHECK (deadline_status IN ('confirmed', 'expected', 'rolling', 'unknown', 'closed')),
  eligibility_notes    TEXT,
  score                REAL,
  score_breakdown_json TEXT,
  verdict              TEXT
                       CHECK (verdict IS NULL OR verdict IN ('apply', 'maybe', 'needs_review', 'skip')),
  first_seen_at        TEXT    NOT NULL,
  last_seen_at         TEXT    NOT NULL,
  closed_at            TEXT
);
CREATE INDEX opportunities_url ON opportunities (url);
CREATE INDEX opportunities_deadline_at ON opportunities (deadline_at);

CREATE TABLE opportunity_sources (
  opportunity_id INTEGER NOT NULL REFERENCES opportunities (id) ON DELETE CASCADE,
  source_id      INTEGER NOT NULL REFERENCES sources (id),
  url            TEXT    NOT NULL,
  first_seen_at  TEXT    NOT NULL,
  last_seen_at   TEXT    NOT NULL,
  PRIMARY KEY (opportunity_id, source_id, url)
);
CREATE INDEX opportunity_sources_source ON opportunity_sources (source_id);

CREATE TABLE programs (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  org                 TEXT,
  url                 TEXT,
  typical_open        TEXT,
  typical_deadline    TEXT,
  last_cycle_deadline TEXT,
  eligibility_json    TEXT,
  deadline_status     TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (deadline_status IN ('confirmed', 'expected', 'rolling', 'unknown', 'closed')),
  next_check_at       TEXT,
  notes               TEXT
);

CREATE TABLE pipeline (
  id                INTEGER PRIMARY KEY,
  opportunity_id    INTEGER REFERENCES opportunities (id) ON DELETE SET NULL,
  program_id        INTEGER REFERENCES programs (id) ON DELETE SET NULL,
  org               TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started', 'drafted', 'sent', 'followup_sent', 'interview',
                                      'rejected', 'offer', 'not_eligible')),
  planned_send_date TEXT,
  sent_at           TEXT,
  followup1_at      TEXT,
  followup2_at      TEXT,
  contact_name      TEXT,
  contact_url       TEXT,
  notes             TEXT,
  updated_at        TEXT NOT NULL
);

CREATE TABLE reminders (
  id            INTEGER PRIMARY KEY,
  target_type   TEXT    NOT NULL CHECK (target_type IN ('opportunity', 'program', 'pipeline')),
  target_id     INTEGER NOT NULL,
  due_at        TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  fired_at      TEXT,
  snoozed_until TEXT
);
CREATE INDEX reminders_due ON reminders (fired_at, due_at);

CREATE TABLE page_snapshots (
  id           INTEGER PRIMARY KEY,
  source_id    INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  content_hash TEXT    NOT NULL,
  text_excerpt TEXT,
  fetched_at   TEXT    NOT NULL
);
CREATE INDEX page_snapshots_source ON page_snapshots (source_id, fetched_at);

CREATE TABLE runs (
  id             INTEGER PRIMARY KEY,
  started_at     TEXT    NOT NULL,
  finished_at    TEXT,
  "trigger"      TEXT    NOT NULL CHECK ("trigger" IN ('schedule', 'startup', 'manual', 'cli')),
  sources_ok     INTEGER NOT NULL DEFAULT 0,
  sources_failed INTEGER NOT NULL DEFAULT 0,
  new_items      INTEGER NOT NULL DEFAULT 0,
  error_summary  TEXT
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;
