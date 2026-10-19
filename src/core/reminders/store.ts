// Reminder storage and firing. Planning is idempotent (unique on target, kind and due date);
// firing collapses everything due for one target into a single notice (the most urgent), so a
// computer that was off for a week gets one reminder per item, not a flood. Quiet hours defer:
// nothing is marked fired while it is quiet.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { utcTimestampSchema } from '../db/schemas';
import { EXPECTED_LABEL } from '../programs/seeds';
import type { Settings } from '../settings/schema';
import { localDaysBetween } from '../time';
import {
  canonicalReminders,
  followupDates,
  isDeadlineKind,
  reminderFamily,
  reminderKey,
  remindersToInsert,
  type PlanningState,
  type ReminderKind,
  type TargetType,
} from './plan';
import { isQuietTime } from './quiet';

export const reminderRowSchema = z.object({
  id: z.int(),
  target_type: z.enum(['opportunity', 'program', 'pipeline', 'manual']),
  target_id: z.int(),
  due_at: utcTimestampSchema,
  kind: z.string(),
  fired_at: utcTimestampSchema.nullable(),
  snoozed_until: utcTimestampSchema.nullable(),
  done_at: utcTimestampSchema.nullable(),
});
export type ReminderRow = z.output<typeof reminderRowSchema>;

const bool = z.union([z.literal(0), z.literal(1)]).transform((v) => v === 1);

const opportunityPlanRow = z.object({
  id: z.int(),
  deadline_at: utcTimestampSchema.nullable(),
  deadline_status: z.string(),
  starred: bool,
  in_pipeline: bool,
  dismissed: bool,
  closed: bool,
});
const programPlanRow = z.object({
  id: z.int(),
  status: z.string(),
  expected_open_at: utcTimestampSchema.nullable(),
  expected_deadline_at: utcTimestampSchema.nullable(),
});
const pipelinePlanRow = z.object({
  id: z.int(),
  status: z.string(),
  sent_at: utcTimestampSchema.nullable(),
  followup1_at: utcTimestampSchema.nullable(),
  followup2_at: utcTimestampSchema.nullable(),
});
const manualPlanRow = z.object({ id: z.int(), deadline_at: utcTimestampSchema });

export function loadPlanningState(db: Database.Database): PlanningState {
  const opportunities = db
    .prepare(
      `SELECT o.id, o.deadline_at, o.deadline_status, o.starred,
              EXISTS (SELECT 1 FROM pipeline p WHERE p.opportunity_id = o.id) AS in_pipeline,
              o.dismissed_at IS NOT NULL AS dismissed, o.closed_at IS NOT NULL AS closed
         FROM opportunities o
        -- Only postings that can have reminders (plan.ts decides the same again); the rest of
        -- a large list is never loaded.
        WHERE o.deadline_at IS NOT NULL AND o.deadline_status = 'confirmed'
          AND o.dismissed_at IS NULL AND o.closed_at IS NULL
          AND (o.starred = 1 OR EXISTS (SELECT 1 FROM pipeline p WHERE p.opportunity_id = o.id))`,
    )
    .all()
    .map((r) => opportunityPlanRow.parse(r));
  const programs = db
    .prepare('SELECT id, status, expected_open_at, expected_deadline_at FROM programs')
    .all()
    .map((r) => programPlanRow.parse(r));
  const pipeline = db
    .prepare(
      'SELECT id, status, sent_at, followup1_at, followup2_at FROM pipeline WHERE sent_at IS NOT NULL',
    )
    .all()
    .map((r) => pipelinePlanRow.parse(r));
  const manual = db
    .prepare('SELECT id, deadline_at FROM manual_deadlines')
    .all()
    .map((r) => manualPlanRow.parse(r));
  return { opportunities, programs, pipeline, manual };
}

export interface SyncResult {
  inserted: number;
  removed: number;
}

/**
 * Brings the reminders table in line with what is tracked: inserts future reminders (and a
 * catch-up for late-tracked items), and removes unfired ones that no longer apply (unstarred,
 * deadline moved, follow-up no longer needed). Fired and done rows are history and are kept.
 */
export function syncReminders(db: Database.Database, now: Date, timeZone: string): SyncResult {
  return db.transaction((): SyncResult => {
    const canonical = canonicalReminders(loadPlanningState(db), timeZone);
    const keep = new Set(canonical.map(reminderKey));
    const known = new Set(
      (
        db.prepare('SELECT DISTINCT target_type, target_id, kind FROM reminders').all() as {
          target_type: string;
          target_id: number;
          kind: string;
        }[]
      ).map((r) => `${r.target_type}:${r.target_id}:${reminderFamily(r.kind)}`),
    );
    const insert = db.prepare(
      `INSERT OR IGNORE INTO reminders (target_type, target_id, due_at, kind)
       VALUES (@target_type, @target_id, @due_at, @kind)`,
    );
    let inserted = 0;
    for (const r of remindersToInsert(canonical, now, known)) inserted += insert.run(r).changes;

    const open = db
      .prepare('SELECT * FROM reminders WHERE fired_at IS NULL AND done_at IS NULL')
      .all()
      .map((r) => reminderRowSchema.parse(r));
    const del = db.prepare('DELETE FROM reminders WHERE id = ?');
    let removed = 0;
    for (const r of open) {
      if (!keep.has(reminderKey({ ...r, kind: r.kind as ReminderKind })))
        removed += del.run(r.id).changes;
    }
    return { inserted, removed };
  })();
}

// ---------- firing ----------

export interface Notice {
  /** Reminder or alert id. */
  id: number;
  source: 'reminder' | 'alert';
  target_type: TargetType | null;
  target_id: number | null;
  kind: string;
  title: string;
  body: string;
  /** Older reminders of the same target folded into this one. */
  collapsed: number;
}

export interface FireResult {
  notices: Notice[];
  /** Due items held back by quiet hours (still unfired). */
  deferred: number;
}

/** Reminders that are due now (snoozed ones count from their snooze time). */
export function dueReminders(db: Database.Database, now: Date): ReminderRow[] {
  return db
    .prepare(
      `SELECT * FROM reminders
        WHERE fired_at IS NULL AND done_at IS NULL AND COALESCE(snoozed_until, due_at) <= ?
        ORDER BY due_at`,
    )
    .all(now.toISOString())
    .map((r) => reminderRowSchema.parse(r));
}

const fmtDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));

function daysPhrase(days: number): string {
  if (days < 0) return 'Deadline passed';
  if (days === 0) return 'Deadline today';
  if (days === 1) return 'Deadline tomorrow';
  return `Deadline in ${days} days`;
}

/** Title and body for a reminder, from the target's current data and the real time left. */
export function describeReminder(
  db: Database.Database,
  r: ReminderRow,
  now: Date,
  timeZone: string,
): { title: string; body: string } | null {
  if (r.target_type === 'opportunity') {
    const o = db
      .prepare('SELECT org, title, deadline_at FROM opportunities WHERE id = ?')
      .get(r.target_id) as { org: string; title: string; deadline_at: string | null } | undefined;
    if (!o?.deadline_at) return null;
    const days = localDaysBetween(now, new Date(o.deadline_at), timeZone);
    return {
      title: `${daysPhrase(days)}: ${o.title}`,
      body: `${o.org} · closes ${fmtDay(o.deadline_at, timeZone)}`,
    };
  }
  if (r.target_type === 'manual') {
    const m = db
      .prepare('SELECT title, org, deadline_at FROM manual_deadlines WHERE id = ?')
      .get(r.target_id) as { title: string; org: string | null; deadline_at: string } | undefined;
    if (!m) return null;
    const days = localDaysBetween(now, new Date(m.deadline_at), timeZone);
    return {
      title: `${daysPhrase(days)}: ${m.title}`,
      body: `${m.org ? `${m.org} · ` : ''}${fmtDay(m.deadline_at, timeZone)}`,
    };
  }
  if (r.target_type === 'program') {
    const p = db
      .prepare(
        'SELECT name, deadline_status, expected_open_at, expected_deadline_at FROM programs WHERE id = ?',
      )
      .get(r.target_id) as
      | {
          name: string;
          deadline_status: string;
          expected_open_at: string | null;
          expected_deadline_at: string | null;
        }
      | undefined;
    if (!p) return null;
    const label = p.deadline_status === 'expected' ? ` (expected, ${EXPECTED_LABEL})` : '';
    if (r.kind === 'opens_soon' && p.expected_open_at) {
      return {
        title: `${p.name}: window should open soon`,
        body: `Expected around ${fmtDay(p.expected_open_at, timeZone)}${label}. Check the page.`,
      };
    }
    if (isDeadlineKind(r.kind) && p.expected_deadline_at) {
      const days = localDaysBetween(now, new Date(p.expected_deadline_at), timeZone);
      return {
        title: `${daysPhrase(days)}: ${p.name}`,
        body: `${fmtDay(p.expected_deadline_at, timeZone)}${label}`,
      };
    }
    return null;
  }
  const row = db
    .prepare(
      `SELECT p.org, p.sent_at, o.title FROM pipeline p
         LEFT JOIN opportunities o ON o.id = p.opportunity_id WHERE p.id = ?`,
    )
    .get(r.target_id) as { org: string; sent_at: string | null; title: string | null } | undefined;
  if (!row?.sent_at) return null;
  const days = localDaysBetween(new Date(row.sent_at), now, timeZone);
  return {
    title: `Follow up with ${row.org}`,
    body: `${row.title ? `${row.title}: sent` : 'Sent'} ${days} days ago and still waiting for an answer.`,
  };
}

export interface FireOptions {
  timeZone: string;
  quietHours: Settings['quietHours'];
}

/**
 * Collects what is due: one notice per target (its most urgent reminder, i.e. the latest due)
 * and one per unnotified alert. Marks them fired, unless it is quiet time, in which case nothing
 * is marked and everything stays due for later.
 */
export function fireDue(db: Database.Database, now: Date, opts: FireOptions): FireResult {
  const due = dueReminders(db, now);
  const alerts = db
    .prepare('SELECT id, title, body FROM alerts WHERE notified_at IS NULL ORDER BY id')
    .all() as { id: number; title: string; body: string }[];
  if (isQuietTime(now, opts.quietHours, opts.timeZone)) {
    return { notices: [], deferred: due.length + alerts.length };
  }

  const groups = new Map<string, ReminderRow[]>();
  for (const r of due) {
    const key = `${r.target_type}:${r.target_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const iso = now.toISOString();
  const markFired = db.prepare('UPDATE reminders SET fired_at = ? WHERE id = ?');
  const markNotified = db.prepare('UPDATE alerts SET notified_at = ? WHERE id = ?');
  return db.transaction((): FireResult => {
    const notices: Notice[] = [];
    for (const list of groups.values()) {
      const top = list.reduce((a, b) => (a.due_at >= b.due_at ? a : b));
      for (const r of list) markFired.run(iso, r.id);
      const text = describeReminder(db, top, now, opts.timeZone);
      if (!text) continue; // the target is gone; nothing to say
      notices.push({
        id: top.id,
        source: 'reminder',
        target_type: top.target_type,
        target_id: top.target_id,
        kind: top.kind,
        ...text,
        collapsed: list.length - 1,
      });
    }
    for (const a of alerts) {
      markNotified.run(iso, a.id);
      const body = a.body.split('\n').slice(0, 3).join('\n');
      notices.push({
        id: a.id,
        source: 'alert',
        target_type: null,
        target_id: null,
        kind: 'page_changed',
        title: a.title,
        body,
        collapsed: 0,
      });
    }
    return { notices, deferred: 0 };
  })();
}

// ---------- user actions ----------

/** Snoozes a reminder (fired or not): it becomes due again at `until`. */
export function snoozeReminder(db: Database.Database, id: number, until: Date): void {
  const changed = db
    .prepare(
      'UPDATE reminders SET snoozed_until = ?, fired_at = NULL WHERE id = ? AND done_at IS NULL',
    )
    .run(until.toISOString(), id).changes;
  if (changed === 0) throw new Error(`No open reminder with id ${id}`);
}

/** Marks a reminder done: it never fires again. */
export function markReminderDone(db: Database.Database, id: number, now: Date): void {
  const changed = db
    .prepare('UPDATE reminders SET done_at = ? WHERE id = ? AND done_at IS NULL')
    .run(now.toISOString(), id).changes;
  if (changed === 0) throw new Error(`No open reminder with id ${id}`);
}

/** Marks a pipeline row Sent and schedules its follow-ups (+7 and +14 days, 09:00 local). */
export function markPipelineSent(
  db: Database.Database,
  id: number,
  sentAt: Date,
  timeZone: string,
): void {
  const iso = sentAt.toISOString();
  const [f1, f2] = followupDates(iso, timeZone);
  const changed = db
    .prepare(
      `UPDATE pipeline SET status = 'sent', sent_at = ?, followup1_at = ?, followup2_at = ?,
         updated_at = ? WHERE id = ?`,
    )
    .run(iso, f1, f2, iso, id).changes;
  if (changed === 0) throw new Error(`No pipeline row with id ${id}`);
}
