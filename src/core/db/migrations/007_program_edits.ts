// Programs edited on the Programs page are the user's: seed sync stops overwriting them
// (edited_at). Seeded programs come back at every start, so only user-added ones can be deleted
// (seeded).
export const sql = /* sql */ `
ALTER TABLE programs ADD COLUMN edited_at TEXT;
ALTER TABLE programs ADD COLUMN seeded INTEGER NOT NULL DEFAULT 0 CHECK (seeded IN (0, 1));
`;
