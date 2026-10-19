// The Programs page's data: each watched program with its window, last cycle, page watch state and
// the latest change alert not yet reviewed. Edits made here belong to the user (edited_at), so
// seed sync leaves them alone.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { localDateSchema } from '../db/pipeline';
import { utcTimestampSchema } from '../db/schemas';
import { endOfLocalDay, startOfLocalDay } from '../time';
import { pageSourceName } from './seeds';

export const PROGRAM_STATUSES = [
  'watching',
  'open',
  'applied',
  'closed',
  'not_applicable',
] as const;
export const programStatusSchema = z.enum(PROGRAM_STATUSES);
export type ProgramStatus = z.output<typeof programStatusSchema>;
export const programDeadlineStatusSchema = z.enum(['confirmed', 'expected', 'rolling', 'unknown']);

export const programItemSchema = z.object({
  id: z.int(),
  name: z.string(),
  org: z.string().nullable(),
  url: z.string().nullable(),
  status: programStatusSchema,
  deadline_status: z.enum(['confirmed', 'expected', 'rolling', 'unknown', 'closed']),
  typical_open: z.string().nullable(),
  typical_deadline: z.string().nullable(),
  last_cycle_deadline: localDateSchema.nullable(),
  expected_open_at: utcTimestampSchema.nullable(),
  expected_deadline_at: utcTimestampSchema.nullable(),
  next_check_at: utcTimestampSchema.nullable(),
  notes: z.string().nullable(),
  seeded: z.union([z.literal(0), z.literal(1)]).transform((v) => v === 1),
  edited_at: utcTimestampSchema.nullable(),
  /** The watched page (a source of kind 'page'). */
  source_id: z.int().nullable(),
  watch_url: z.string().nullable(),
  last_checked_at: utcTimestampSchema.nullable(),
  last_error: z.string().nullable(),
  /** Latest "page changed, review" alert not yet reviewed. */
  alert_id: z.int().nullable(),
  alert_body: z.string().nullable(),
  alert_at: utcTimestampSchema.nullable(),
});
export type ProgramItem = z.output<typeof programItemSchema>;

export function listPrograms(db: Database.Database): ProgramItem[] {
  return db
    .prepare(
      `SELECT p.id, p.name, p.org, p.url, p.status, p.deadline_status, p.typical_open,
              p.typical_deadline, p.last_cycle_deadline, p.expected_open_at, p.expected_deadline_at,
              p.next_check_at, p.notes, p.seeded, p.edited_at, p.source_id,
              CASE WHEN s.enabled = 1 THEN s.url END AS watch_url,
              s.last_ok_at AS last_checked_at, s.last_error,
              a.id AS alert_id, a.body AS alert_body, a.created_at AS alert_at
         FROM programs p
         LEFT JOIN sources s ON s.id = p.source_id
         LEFT JOIN alerts a ON a.id = (
           SELECT id FROM alerts WHERE program_id = p.id AND seen_at IS NULL ORDER BY id DESC LIMIT 1)
        ORDER BY (a.id IS NULL), p.seeded DESC, p.id`,
    )
    .all()
    .map((r) => programItemSchema.parse(r));
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable();
const webUrl = z
  .string()
  .trim()
  .transform((s) => (s === '' ? null : s))
  .refine((s) => s === null || /^https?:\/\/\S+$/i.test(s), 'must be an http(s) link')
  .nullable();

/** Editable fields; dates are local calendar days ("2027-02-28"). */
export const programPatchSchema = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  org: text(200).optional(),
  url: webUrl.optional(),
  status: programStatusSchema.optional(),
  deadline_status: programDeadlineStatusSchema.optional(),
  typical_open: text(100).optional(),
  typical_deadline: text(100).optional(),
  open_date: localDateSchema.nullable().optional(),
  deadline_date: localDateSchema.nullable().optional(),
  notes: text(4000).optional(),
  /** Saving from a change alert ("Update deadline") also marks it reviewed. */
  review_alert_id: z.int().positive().optional(),
});
export type ProgramPatch = z.input<typeof programPatchSchema>;
export const programNewSchema = programPatchSchema.extend({
  name: z.string().trim().min(1).max(200),
});
export type ProgramNew = z.input<typeof programNewSchema>;

const day = (date: string, edge: 'start' | 'end', tz: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (
    edge === 'start' ? startOfLocalDay(y, m, d, tz) : endOfLocalDay(y, m, d, tz)
  ).toISOString();
};

const TOS =
  'Program page, fetched about once a day through the shared fetch layer (robots.txt, 1 request/s per host).';

/** Points the program's watched page at `url` (creating the source), or disables it. */
function setWatchedPage(
  db: Database.Database,
  id: number,
  name: string,
  url: string | null,
  now: Date,
): void {
  const row = db.prepare('SELECT source_id FROM programs WHERE id = ?').get(id) as {
    source_id: number | null;
  };
  if (row.source_id !== null) {
    const before = db.prepare('SELECT url FROM sources WHERE id = ?').get(row.source_id) as
      { url: string | null } | undefined;
    if (before && before.url !== url) {
      // A different page: start a new baseline instead of diffing two unrelated pages.
      db.prepare('DELETE FROM page_snapshots WHERE source_id = ?').run(row.source_id);
      db.prepare('UPDATE sources SET last_ok_at = NULL, last_error = NULL WHERE id = ?').run(
        row.source_id,
      );
    }
    db.prepare('UPDATE sources SET url = ?, enabled = ?, name = ? WHERE id = ?').run(
      url,
      url ? 1 : 0,
      pageSourceName(name),
      row.source_id,
    );
    return;
  }
  if (!url) return;
  const existing = db
    .prepare("SELECT id FROM sources WHERE kind = 'page' AND name = ?")
    .get(pageSourceName(name)) as { id: number } | undefined;
  const sourceId =
    existing?.id ??
    (
      db
        .prepare(
          `INSERT INTO sources (kind, name, url, config_json, access_method, tos_note, enabled, created_at)
         VALUES ('page', ?, ?, '{}', 'public_html', ?, 1, ?) RETURNING id`,
        )
        .get(pageSourceName(name), url, TOS, now.toISOString()) as { id: number }
    ).id;
  if (existing)
    db.prepare('UPDATE sources SET url = ?, enabled = 1 WHERE id = ?').run(url, existing.id);
  db.prepare('UPDATE programs SET source_id = ? WHERE id = ?').run(sourceId, id);
}

export function getProgram(db: Database.Database, id: number): ProgramItem {
  const item = listPrograms(db).find((p) => p.id === id);
  if (!item) throw new Error(`No program with id ${id}`);
  return item;
}

export function updateProgram(
  db: Database.Database,
  id: number,
  patch: ProgramPatch,
  timeZone: string,
  now: Date,
): ProgramItem {
  const p = programPatchSchema.parse(patch);
  return db.transaction((): ProgramItem => {
    const before = getProgram(db, id);
    const sets: string[] = [];
    const values: Record<string, unknown> = { id, edited_at: now.toISOString() };
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = @${column}`);
      values[column] = value;
    };
    for (const k of [
      'name',
      'org',
      'url',
      'status',
      'deadline_status',
      'typical_open',
      'typical_deadline',
      'notes',
    ] as const) {
      if (p[k] !== undefined) set(k, p[k]);
    }
    if (p.open_date !== undefined)
      set('expected_open_at', p.open_date ? day(p.open_date, 'start', timeZone) : null);
    if (p.deadline_date !== undefined)
      set('expected_deadline_at', p.deadline_date ? day(p.deadline_date, 'end', timeZone) : null);
    if (sets.length > 0) {
      if (p.name !== undefined && p.name !== before.name) {
        const clash = db
          .prepare('SELECT 1 FROM programs WHERE name = ? AND id <> ?')
          .get(p.name, id);
        if (clash) throw new Error(`A program named "${p.name}" already exists`);
      }
      db.prepare(
        `UPDATE programs SET ${sets.join(', ')}, edited_at = @edited_at WHERE id = @id`,
      ).run(values);
    }
    if (p.url !== undefined || (p.name !== undefined && p.name !== before.name)) {
      const url = p.url !== undefined ? p.url : before.url;
      setWatchedPage(db, id, p.name ?? before.name, url, now);
    }
    if (p.review_alert_id) markAlertReviewed(db, p.review_alert_id, now);
    return getProgram(db, id);
  })();
}

export function createProgram(
  db: Database.Database,
  input: ProgramNew,
  timeZone: string,
  now: Date,
): ProgramItem {
  const p = programNewSchema.parse(input);
  return db.transaction((): ProgramItem => {
    if (db.prepare('SELECT 1 FROM programs WHERE name = ?').get(p.name)) {
      throw new Error(`A program named "${p.name}" already exists`);
    }
    const { id } = db
      .prepare(
        `INSERT INTO programs (name, deadline_status, next_check_at, seeded) VALUES (?, 'unknown', ?, 0) RETURNING id`,
      )
      .get(p.name, now.toISOString()) as { id: number };
    const { name: _name, ...rest } = p;
    return updateProgram(db, id, { ...rest, url: rest.url ?? null }, timeZone, now);
  })();
}

/** Deletes a program you added, with its watched page, alerts and reminders. Seeded ones refuse. */
export function deleteProgram(db: Database.Database, id: number): number {
  return db.transaction(() => {
    const row = db.prepare('SELECT seeded, source_id FROM programs WHERE id = ?').get(id) as
      { seeded: number; source_id: number | null } | undefined;
    if (!row) throw new Error(`No program with id ${id}`);
    if (row.seeded)
      throw new Error(
        'Programs from the watchlist seed come back at every start; mark it Not applicable instead',
      );
    db.prepare("DELETE FROM reminders WHERE target_type = 'program' AND target_id = ?").run(id);
    db.prepare('DELETE FROM alerts WHERE program_id = ?').run(id);
    const changes = db.prepare('DELETE FROM programs WHERE id = ?').run(id).changes;
    if (row.source_id !== null) db.prepare('DELETE FROM sources WHERE id = ?').run(row.source_id);
    return changes;
  })();
}

export function markAlertReviewed(db: Database.Database, alertId: number, now: Date): void {
  const changed = db
    .prepare('UPDATE alerts SET seen_at = ? WHERE id = ? AND seen_at IS NULL')
    .run(now.toISOString(), alertId).changes;
  if (changed === 0) throw new Error(`No unreviewed alert with id ${alertId}`);
}
