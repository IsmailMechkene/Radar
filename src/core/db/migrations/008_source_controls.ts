// Sources page controls. `enabled` stays the seed's say (an adapter exists); `paused` is the
// user's switch and survives seed sync. `added_by_user` marks sources added on the Sources page:
// only those can be deleted (seeded ones come back at every start).
export const sql = /* sql */ `
ALTER TABLE sources ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1));
ALTER TABLE sources ADD COLUMN added_by_user INTEGER NOT NULL DEFAULT 0 CHECK (added_by_user IN (0, 1));
`;
