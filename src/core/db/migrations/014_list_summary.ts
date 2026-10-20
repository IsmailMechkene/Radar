// Opportunities list speed. The one-line score summary gets its own column, so the list never
// reads or parses the full breakdown JSON. A covering index on open postings holds every column
// the list reads, in list order: rows keep their (large) description in the middle, and reading
// a column stored after it meant decrypting the description's overflow pages for every posting.
// Keep this column list in step with listOpportunityItems.
export const sql = /* sql */ `
ALTER TABLE opportunities ADD COLUMN score_summary TEXT;
UPDATE opportunities SET score_summary = json_extract(score_breakdown_json, '$.summary')
 WHERE score_breakdown_json IS NOT NULL AND json_valid(score_breakdown_json);
CREATE INDEX opportunities_list ON opportunities (
  score DESC, first_seen_at DESC, id, source_id, org, title, location, remote_type,
  opportunity_type, url, apply_url, posted_at, deadline_at, deadline_status, verdict,
  score_summary, starred, dismissed_at, closed_at
) WHERE dismissed_at IS NULL AND closed_at IS NULL;
`;
