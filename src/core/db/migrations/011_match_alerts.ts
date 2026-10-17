// New-match alerts: each posting is considered once. alerted_at is set when it has been handled
// (alerted, or found not to qualify), so re-scoring or another source finding it never alerts
// again. Postings already in the database are handled: the first run does not alert the backlog.
export const sql = /* sql */ `
ALTER TABLE opportunities ADD COLUMN alerted_at TEXT;
UPDATE opportunities SET alerted_at = first_seen_at;
CREATE INDEX opportunities_alert_pending ON opportunities (id) WHERE alerted_at IS NULL;
`;
