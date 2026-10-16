// Pipeline rows that are not linked to a scanned opportunity (outreach to IAESTE, a lab, ...) need
// their own role text, shown under the organization.
export const sql = /* sql */ `
ALTER TABLE pipeline ADD COLUMN role TEXT;
`;
