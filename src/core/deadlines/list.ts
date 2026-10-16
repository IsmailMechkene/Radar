// What the Deadlines page shows (SPEC section 9): every dated deadline (open opportunities,
// programs' expected windows, manual deadlines) plus follow-ups that are due, with the reminder
// state behind Snooze and Done.
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { localDateSchema } from '../db/pipeline';
import { utcTimestampSchema } from '../db/schemas';
import { endOfLocalDay } from '../time';

export const deadlineTargetSchema = z.enum(['opportunity', 'program', 'manual', 'pipeline']);
export type DeadlineTarget = z.output<typeof deadlineTargetSchema>;

export interface DeadlineEvent {
  /** Unique per event, e.g. "program:3:opens". */
  key: string;
  target_type: Exclude<DeadlineTarget, 'pipeline'>;
  target_id: number;
  /** A closing date, or (programs) the expected opening of the window. */
  event: 'deadline' | 'opens';
  title: string;
  org: string | null;
  /** UTC ISO: end of day for deadlines, start of day for openings. */
  at: string;
  /** Expected = copied from the last cycle, unverified. */
  status: 'confirmed' | 'expected';
  url: string | null;
  /** The sentence the date was read from, when there is one. */
  sentence: string | null;
  /** Reminders run for it (starred or in the pipeline, a watched program, a manual deadline). */
  tracked: boolean;
  /** Marked done: its reminders are all done. */
  done: boolean;
  /** Hidden from "Due soon" until then. */
  snoozed_until: string | null;
}

/** A follow-up reminder that is due and not done (the row is still waiting for an answer). */
export interface DueFollowup {
  key: string;
  target_type: 'pipeline';
  target_id: number;
  reminder_id: number;
  org: string;
  role: string | null;
  due_at: string;
  kind: 'followup_1' | 'followup_2';
}

export interface DeadlinesView {
  events: DeadlineEvent[];
  followups: DueFollowup[];
}

interface ReminderState {
  done: boolean;
  snoozed_until: string | null;
}

function reminderStates(db: Database.Database, now: Date): Map<string, ReminderState> {
  const rows = db
    .prepare(
      `SELECT target_type, target_id,
              COUNT(*) AS total, COUNT(done_at) AS done,
              MAX(CASE WHEN done_at IS NULL AND snoozed_until > @now THEN snoozed_until END) AS snoozed
         FROM reminders WHERE kind <> 'followup_1' AND kind <> 'followup_2'
        GROUP BY target_type, target_id`,
    )
    .all({ now: now.toISOString() }) as {
    target_type: string;
    target_id: number;
    total: number;
    done: number;
    snoozed: string | null;
  }[];
  return new Map(
    rows.map((r) => [
      `${r.target_type}:${r.target_id}`,
      { done: r.total > 0 && r.done === r.total, snoozed_until: r.snoozed },
    ]),
  );
}

const bool = z.union([z.literal(0), z.literal(1)]).transform((v) => v === 1);

export function listDeadlines(db: Database.Database, now: Date): DeadlinesView {
  const state = reminderStates(db, now);
  const of = (type: string, id: number): ReminderState =>
    state.get(`${type}:${id}`) ?? { done: false, snoozed_until: null };
  const events: DeadlineEvent[] = [];

  const opportunities = db
    .prepare(
      `SELECT o.id, o.title, o.org, o.deadline_at, o.deadline_status, o.url, o.deadline_text,
              (o.starred = 1 OR EXISTS (SELECT 1 FROM pipeline p WHERE p.opportunity_id = o.id)) AS tracked
         FROM opportunities o
        WHERE o.deadline_at IS NOT NULL AND o.dismissed_at IS NULL AND o.closed_at IS NULL`,
    )
    .all()
    .map((r) =>
      z
        .object({
          id: z.int(),
          title: z.string(),
          org: z.string(),
          deadline_at: utcTimestampSchema,
          deadline_status: z.string(),
          url: z.string(),
          deadline_text: z.string().nullable(),
          tracked: bool,
        })
        .parse(r),
    );
  for (const o of opportunities) {
    events.push({
      key: `opportunity:${o.id}:deadline`,
      target_type: 'opportunity',
      target_id: o.id,
      event: 'deadline',
      title: o.title,
      org: o.org,
      at: o.deadline_at,
      status: o.deadline_status === 'expected' ? 'expected' : 'confirmed',
      url: o.url,
      sentence: o.deadline_text,
      // Only confirmed deadlines of starred or pipeline postings get reminders (plan.ts).
      tracked: o.tracked && o.deadline_status === 'confirmed',
      ...of('opportunity', o.id),
    });
  }

  const programs = db
    .prepare(
      `SELECT id, name, org, url, status, deadline_status, expected_open_at, expected_deadline_at
         FROM programs WHERE expected_open_at IS NOT NULL OR expected_deadline_at IS NOT NULL`,
    )
    .all()
    .map((r) =>
      z
        .object({
          id: z.int(),
          name: z.string(),
          org: z.string().nullable(),
          url: z.string().nullable(),
          status: z.string(),
          deadline_status: z.string(),
          expected_open_at: utcTimestampSchema.nullable(),
          expected_deadline_at: utcTimestampSchema.nullable(),
        })
        .parse(r),
    );
  for (const p of programs) {
    const base = {
      target_type: 'program' as const,
      target_id: p.id,
      title: p.name,
      org: p.org,
      status: p.deadline_status === 'confirmed' ? ('confirmed' as const) : ('expected' as const),
      url: p.url,
      sentence: null,
      tracked: p.status === 'watching' || p.status === 'open',
      ...of('program', p.id),
    };
    if (p.expected_open_at) {
      events.push({
        ...base,
        key: `program:${p.id}:opens`,
        event: 'opens',
        at: p.expected_open_at,
      });
    }
    if (p.expected_deadline_at) {
      events.push({
        ...base,
        key: `program:${p.id}:deadline`,
        event: 'deadline',
        at: p.expected_deadline_at,
      });
    }
  }

  const manual = db
    .prepare('SELECT id, title, org, deadline_at, url, notes FROM manual_deadlines')
    .all()
    .map((r) =>
      z
        .object({
          id: z.int(),
          title: z.string(),
          org: z.string().nullable(),
          deadline_at: utcTimestampSchema,
          url: z.string().nullable(),
          notes: z.string().nullable(),
        })
        .parse(r),
    );
  for (const m of manual) {
    events.push({
      key: `manual:${m.id}:deadline`,
      target_type: 'manual',
      target_id: m.id,
      event: 'deadline',
      title: m.title,
      org: m.org,
      at: m.deadline_at,
      status: 'confirmed',
      url: m.url,
      sentence: m.notes,
      tracked: true,
      ...of('manual', m.id),
    });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key));

  const followups = db
    .prepare(
      `SELECT r.id AS reminder_id, r.target_id, r.kind, COALESCE(r.snoozed_until, r.due_at) AS due_at,
              p.org, COALESCE(p.role, o.title, g.name) AS role
         FROM reminders r
         JOIN pipeline p ON p.id = r.target_id
         LEFT JOIN opportunities o ON o.id = p.opportunity_id
         LEFT JOIN programs g ON g.id = p.program_id
        WHERE r.target_type = 'pipeline' AND r.kind IN ('followup_1', 'followup_2')
          AND r.done_at IS NULL AND COALESCE(r.snoozed_until, r.due_at) <= @now
          AND (p.status = 'sent' OR (p.status = 'followup_sent' AND r.kind = 'followup_2'))
        ORDER BY due_at`,
    )
    .all({ now: now.toISOString() })
    .map((r) =>
      z
        .object({
          reminder_id: z.int(),
          target_id: z.int(),
          kind: z.enum(['followup_1', 'followup_2']),
          due_at: utcTimestampSchema,
          org: z.string(),
          role: z.string().nullable(),
        })
        .parse(r),
    )
    .map((r) => ({
      ...r,
      key: `pipeline:${r.target_id}:${r.kind}`,
      target_type: 'pipeline' as const,
    }));

  return { events, followups };
}

// ---------- Snooze and Done ----------

/**
 * Snoozes a target: its most recent reminder that is due (fired or not) comes back at `until`,
 * and the target leaves "Due soon" until then. Throws when nothing is due yet.
 */
export function snoozeTarget(
  db: Database.Database,
  type: DeadlineTarget,
  id: number,
  until: Date,
  now: Date,
): number {
  const row = db
    .prepare(
      `SELECT id FROM reminders
        WHERE target_type = ? AND target_id = ? AND done_at IS NULL AND due_at <= ?
        ORDER BY due_at DESC LIMIT 1`,
    )
    .get(type, id, now.toISOString()) as { id: number } | undefined;
  if (!row) throw new Error('No reminder is due for this item yet');
  db.prepare('UPDATE reminders SET snoozed_until = ?, fired_at = NULL WHERE id = ?').run(
    until.toISOString(),
    row.id,
  );
  return row.id;
}

/** Marks every open reminder of a target done (no more reminders). Returns their ids for Undo. */
export function markTargetDone(
  db: Database.Database,
  type: DeadlineTarget,
  id: number,
  now: Date,
): number[] {
  return db.transaction(() => {
    const ids = (
      db
        .prepare(
          'SELECT id FROM reminders WHERE target_type = ? AND target_id = ? AND done_at IS NULL',
        )
        .all(type, id) as { id: number }[]
    ).map((r) => r.id);
    if (ids.length === 0) throw new Error('This item has no open reminders');
    const set = db.prepare('UPDATE reminders SET done_at = ? WHERE id = ?');
    for (const r of ids) set.run(now.toISOString(), r);
    return ids;
  })();
}

/** Undo of `markTargetDone`. */
export function undoDone(db: Database.Database, ids: readonly number[]): number {
  if (ids.length === 0) return 0;
  return db
    .prepare(`UPDATE reminders SET done_at = NULL WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .run(...ids).changes;
}

// ---------- manual deadlines ----------

export const manualDeadlineInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  org: z
    .string()
    .trim()
    .max(200)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional(),
  /** Local calendar day; the deadline is the end of that day in the user's time zone. */
  date: localDateSchema,
  url: z
    .string()
    .trim()
    .max(500)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional(),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional(),
});
export type ManualDeadlineInput = z.input<typeof manualDeadlineInputSchema>;

export function addManualDeadline(
  db: Database.Database,
  input: ManualDeadlineInput,
  timeZone: string,
  now: Date,
): number {
  const m = manualDeadlineInputSchema.parse(input);
  const [y, mo, d] = m.date.split('-').map(Number) as [number, number, number];
  const { id } = db
    .prepare(
      `INSERT INTO manual_deadlines (title, org, deadline_at, url, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      m.title,
      m.org ?? null,
      endOfLocalDay(y, mo, d, timeZone).toISOString(),
      m.url ?? null,
      m.notes ?? null,
      now.toISOString(),
    ) as { id: number };
  return id;
}

/** Deletes a manual deadline and its reminders. */
export function removeManualDeadline(db: Database.Database, id: number): number {
  return db.transaction(() => {
    db.prepare("DELETE FROM reminders WHERE target_type = 'manual' AND target_id = ?").run(id);
    return db.prepare('DELETE FROM manual_deadlines WHERE id = ?').run(id).changes;
  })();
}
