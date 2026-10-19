// Dev-only sample data so the Opportunities page can be built and checked before any scanner
// exists. Everything is tagged with source kind 'sample' and can be removed in one call.
// Dates are relative to `now`, so the sample never goes stale.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { applyScore, upsertOpportunity } from '../db/opportunities';
import {
  accessMethodSchema,
  deadlineStatusSchema,
  languageSchema,
  opportunityTypeSchema,
  remoteTypeSchema,
  scoreSignalSchema,
  verdictSchema,
} from '../db/schemas';
import { insertSource } from '../db/sources';

export const SAMPLE_SOURCE_KIND = 'sample';
const DAY_MS = 86_400_000;

const sampleItemSchema = z.strictObject({
  key: z.string().min(1),
  org: z.string().min(1),
  title: z.string().min(1),
  location: z.string().nullable(),
  remote_type: remoteTypeSchema,
  opportunity_type: opportunityTypeSchema,
  language: languageSchema,
  /** Sample source names; the first is the primary source. */
  sources: z.array(z.string().min(1)).min(1),
  description: z.string().nullable(),
  posted_days_ago: z.int().nonnegative(),
  first_seen_hours_ago: z.number().nonnegative(),
  deadline_in_days: z.int().nullable(),
  deadline_status: deadlineStatusSchema,
  deadline_text: z.string().nullable(),
  eligibility_notes: z.string().nullable(),
  score: z.number().min(0).max(100),
  verdict: verdictSchema,
  summary: z.string(),
  signals: z.array(scoreSignalSchema),
  starred: z.boolean(),
});

export const sampleFileSchema = z.strictObject({
  version: z.literal(1),
  sources: z.array(z.strictObject({ name: z.string().min(1), access_method: accessMethodSchema })),
  items: z.array(sampleItemSchema),
});

/** Removes every sample opportunity, its links and pipeline rows, and the sample sources. */
export function clearSampleData(db: Database.Database): number {
  return db.transaction(() => {
    const sourceIds = `SELECT id FROM sources WHERE kind = '${SAMPLE_SOURCE_KIND}'`;
    const oppIds = `SELECT id FROM opportunities WHERE source_id IN (${sourceIds})`;
    db.prepare(`DELETE FROM pipeline WHERE opportunity_id IN (${oppIds})`).run();
    db.prepare(`DELETE FROM opportunity_sources WHERE opportunity_id IN (${oppIds})`).run();
    const removed = db.prepare(`DELETE FROM opportunities WHERE id IN (${oppIds})`).run().changes;
    db.prepare(`DELETE FROM opportunity_sources WHERE source_id IN (${sourceIds})`).run();
    db.prepare(`DELETE FROM sources WHERE kind = '${SAMPLE_SOURCE_KIND}'`).run();
    return removed;
  })();
}

/** Replaces any previous sample data with the fixture. Returns the number of opportunities. */
export function loadSampleData(db: Database.Database, raw: unknown, now: Date): number {
  const file = sampleFileSchema.parse(raw);
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();

  return db.transaction(() => {
    clearSampleData(db);
    const sourceIds = new Map<string, number>();
    for (const s of file.sources) {
      const row = insertSource(
        db,
        {
          kind: SAMPLE_SOURCE_KIND,
          name: s.name,
          access_method: s.access_method,
          tos_note: 'Development sample data, not a real source',
        },
        now,
      );
      sourceIds.set(s.name, row.id);
    }
    const sourceId = (name: string) => {
      const id = sourceIds.get(name);
      if (id === undefined) throw new Error(`Sample item uses unknown source "${name}"`);
      return id;
    };

    for (const item of file.items) {
      const url = `https://example.com/radar-sample/${item.key}`;
      const firstSeen = at(-item.first_seen_hours_ago * 3_600_000);
      let id = 0;
      item.sources.forEach((name, i) => {
        const { opportunity } = upsertOpportunity(
          db,
          {
            dedupe_key: `sample|${item.key}`,
            source_id: sourceId(name),
            org: item.org,
            title: item.title,
            location: item.location,
            remote_type: item.remote_type,
            opportunity_type: item.opportunity_type,
            language: item.language,
            url: i === 0 ? url : `${url}?via=${i}`,
            apply_url: `${url}/apply`,
            description: item.description,
            posted_at: at(-item.posted_days_ago * DAY_MS),
            // End of day in Central Europe (21:59 UTC = 23:59 CEST/22:59 CET).
            deadline_at:
              item.deadline_in_days === null
                ? null
                : (() => {
                    const d = new Date(now.getTime() + item.deadline_in_days * DAY_MS);
                    d.setUTCHours(21, 59, 0, 0);
                    return d.toISOString();
                  })(),
            deadline_status: item.deadline_status,
            deadline_text: item.deadline_text,
            eligibility_notes: item.eligibility_notes,
          },
          now,
        );
        id = opportunity.id;
      });
      db.prepare('UPDATE opportunities SET first_seen_at = ?, starred = ? WHERE id = ?').run(
        firstSeen,
        item.starred ? 1 : 0,
        id,
      );
      db.prepare('UPDATE opportunity_sources SET first_seen_at = ? WHERE opportunity_id = ?').run(
        firstSeen,
        id,
      );
      applyScore(db, id, {
        score: item.score,
        verdict: item.verdict,
        breakdown: { version: 1, summary: item.summary, signals: item.signals },
      });
    }
    return file.items.length;
  })();
}
