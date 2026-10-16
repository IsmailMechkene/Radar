// Rules edited on the Rules page. seeds/rules.json ships inside the app (read-only once
// packaged), so the user's version lives here; no row means the seed file's rules apply.
export const sql = /* sql */ `
CREATE TABLE user_rules (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  rules_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
