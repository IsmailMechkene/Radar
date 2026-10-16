// A source is identified by its adapter kind and name, so seeds/sources.json can be synced
// repeatedly without creating duplicates.
export const sql = /* sql */ `
CREATE UNIQUE INDEX sources_kind_name ON sources (kind, name);
CREATE INDEX opportunity_sources_url ON opportunity_sources (url);
`;
