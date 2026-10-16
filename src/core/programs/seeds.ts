// Programs watchlist (seeds/programs.json, SPEC section 10). Last-cycle windows become `expected`
// dates, never `confirmed`, and are labelled as unverified everywhere they are shown.
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { endOfLocalDay, startOfLocalDay } from '../time';

export const EXPECTED_LABEL = 'from last cycle, unverified';

const localDate = z.iso.date();

export const seedProgramSchema = z.strictObject({
  name: z.string().trim().min(1),
  org: z.string().trim().min(1),
  url: z.url().nullable(),
  /** The page to watch for changes when it differs from `url`. */
  watch_url: z.url().optional(),
  typical_open: z.string().nullable(),
  typical_deadline: z.string().nullable(),
  last_cycle_deadline: localDate.nullable(),
  /** Local calendar dates (user's time zone) of the next cycle, inferred from the last one. */
  expected_open: localDate.nullable(),
  expected_deadline: localDate.nullable(),
  deadline_status: z.enum(['expected', 'rolling', 'unknown']),
  eligibility: z.record(z.string(), z.string()),
  notes: z.string(),
});
export type SeedProgram = z.output<typeof seedProgramSchema>;

export const seedProgramsFileSchema = z
  .strictObject({ version: z.literal(1), programs: z.array(seedProgramSchema) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.programs.forEach((p, i) => {
      const key = p.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate program "${p.name}"`,
          path: ['programs', i],
        });
      }
      seen.add(key);
      if (p.deadline_status !== 'expected' && (p.expected_open || p.expected_deadline)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${p.name}": expected dates need deadline_status "expected"`,
          path: ['programs', i, 'deadline_status'],
        });
      }
    });
  });

export function parseSeedPrograms(raw: unknown): SeedProgram[] {
  return seedProgramsFileSchema.parse(raw).programs;
}

function toInstant(date: string | null, edge: 'start' | 'end', tz: string): string | null {
  if (!date) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (
    edge === 'start' ? startOfLocalDay(y, m, d, tz) : endOfLocalDay(y, m, d, tz)
  ).toISOString();
}

export const pageSourceName = (program: string) => `${program} (program page)`;

export interface ProgramSyncResult {
  inserted: number;
  updated: number;
  watched: number;
}

/**
 * Upserts programs by name. The user's status is kept; once a date has been confirmed on the
 * live page (deadline_status 'confirmed'), the seed no longer overwrites dates. Each program with
 * a URL gets a source of kind 'page' so its page is watched for changes.
 */
export function syncSeedPrograms(
  db: Database.Database,
  programs: readonly SeedProgram[],
  timeZone: string,
  now: Date,
): ProgramSyncResult {
  const find = db.prepare('SELECT id, deadline_status FROM programs WHERE name = ?');
  const insert = db.prepare(
    `INSERT INTO programs (name, org, url, typical_open, typical_deadline, last_cycle_deadline,
       eligibility_json, deadline_status, notes, expected_open_at, expected_deadline_at, next_check_at)
     VALUES (@name, @org, @url, @typical_open, @typical_deadline, @last_cycle_deadline,
       @eligibility_json, @deadline_status, @notes, @expected_open_at, @expected_deadline_at, @now)
     RETURNING id`,
  );
  const updateInfo = db.prepare(
    `UPDATE programs SET org = @org, url = @url, typical_open = @typical_open,
       typical_deadline = @typical_deadline, last_cycle_deadline = @last_cycle_deadline,
       eligibility_json = @eligibility_json, notes = @notes WHERE id = @id`,
  );
  const updateDates = db.prepare(
    `UPDATE programs SET deadline_status = @deadline_status, expected_open_at = @expected_open_at,
       expected_deadline_at = @expected_deadline_at WHERE id = @id`,
  );
  const findSource = db.prepare("SELECT id FROM sources WHERE kind = 'page' AND name = ?");
  const insertSource = db.prepare(
    `INSERT INTO sources (kind, name, url, config_json, access_method, tos_note, enabled, created_at)
     VALUES ('page', ?, ?, '{}', 'public_html', ?, 1, ?) RETURNING id`,
  );
  const updateSource = db.prepare('UPDATE sources SET url = ?, enabled = ? WHERE id = ?');
  const link = db.prepare('UPDATE programs SET source_id = ? WHERE id = ?');

  return db.transaction((): ProgramSyncResult => {
    const out = { inserted: 0, updated: 0, watched: 0 };
    for (const p of programs) {
      const row = {
        name: p.name,
        org: p.org,
        url: p.url,
        typical_open: p.typical_open,
        typical_deadline: p.typical_deadline,
        last_cycle_deadline: p.last_cycle_deadline,
        eligibility_json: JSON.stringify(p.eligibility),
        deadline_status: p.deadline_status,
        notes: p.deadline_status === 'expected' ? `Dates ${EXPECTED_LABEL}. ${p.notes}` : p.notes,
        expected_open_at: toInstant(p.expected_open, 'start', timeZone),
        expected_deadline_at: toInstant(p.expected_deadline, 'end', timeZone),
      };
      const existing = find.get(p.name) as { id: number; deadline_status: string } | undefined;
      let id: number;
      if (existing) {
        id = existing.id;
        updateInfo.run({ ...row, id });
        if (existing.deadline_status !== 'confirmed') updateDates.run({ ...row, id });
        out.updated += 1;
      } else {
        id = (insert.get({ ...row, now: now.toISOString() }) as { id: number }).id;
        out.inserted += 1;
      }

      const watchUrl = p.watch_url ?? p.url;
      const source = findSource.get(pageSourceName(p.name)) as { id: number } | undefined;
      if (source) updateSource.run(watchUrl, watchUrl ? 1 : 0, source.id);
      let sourceId = source?.id ?? null;
      if (!source && watchUrl) {
        sourceId = (
          insertSource.get(
            pageSourceName(p.name),
            watchUrl,
            'Program page, fetched about once a day through the shared fetch layer (robots.txt, 1 request/s per host).',
            now.toISOString(),
          ) as { id: number }
        ).id;
      }
      link.run(sourceId, id);
      if (watchUrl) out.watched += 1;
    }
    return out;
  })();
}
