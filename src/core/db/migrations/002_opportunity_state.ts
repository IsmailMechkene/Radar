// User state on opportunities (star, dismiss) and the original deadline sentence (SPEC section 7:
// "Always store the original sentence next to the parsed date").
export const sql = /* sql */ `
ALTER TABLE opportunities ADD COLUMN starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1));
ALTER TABLE opportunities ADD COLUMN dismissed_at TEXT;
ALTER TABLE opportunities ADD COLUMN deadline_text TEXT;
CREATE INDEX opportunities_dismissed_score ON opportunities (dismissed_at, score);
`;
