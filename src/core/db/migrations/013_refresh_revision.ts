// Incremental passes: a scan bumps `revision` when a posting's content changes (or it reopens),
// and the deadline + score passes set `scored_revision` to the revision they read. After a scan
// only rows with scored_revision < revision are processed. Existing rows start out pending, so
// the first start after this migration does one full pass as before.
export const sql = /* sql */ `
ALTER TABLE opportunities ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE opportunities ADD COLUMN scored_revision INTEGER NOT NULL DEFAULT 0;
CREATE INDEX opportunities_refresh_pending ON opportunities (id) WHERE scored_revision < revision;
`;
