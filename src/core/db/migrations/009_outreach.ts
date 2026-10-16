// Outreach (SPEC section 9): email templates with [merge fields], and one draft per pipeline row
// (the chosen template and the values typed for its fields). Radar never sends anything.
export const sql = /* sql */ `
CREATE TABLE outreach_templates (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('cold', 'followup')),
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE outreach_drafts (
  pipeline_id INTEGER PRIMARY KEY REFERENCES pipeline (id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES outreach_templates (id) ON DELETE SET NULL,
  fields_json TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL
);
`;
