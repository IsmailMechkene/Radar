// Reminder planning (SPEC section 7), pure and clock-injected. Given a snapshot of what is
// tracked, it lists the reminders that should exist. Storage and firing live in store.ts.
//
// - Deadlines of starred or pipeline opportunities, and of watched programs: T-30, T-14, T-7,
//   T-2 and T-0 days, at 09:00 local time.
// - Programs with an expected opening date: "window should open soon" 14 days before.
// - Pipeline rows marked Sent: follow-ups at +7 and +14 days, while the row is still Sent
//   (the second one also after "Follow-up sent").
import { addLocalDays, zonedToUtc } from '../time';

export const DEADLINE_OFFSETS = [30, 14, 7, 2, 0] as const;
export const OPENS_SOON_DAYS = 14;
export const FOLLOWUP_DAYS = [7, 14] as const;
/** Local hour at which day-based reminders are due. */
export const REMINDER_HOUR = 9;

export type TargetType = 'opportunity' | 'program' | 'pipeline' | 'manual';
export type ReminderKind =
  | 'deadline_t30'
  | 'deadline_t14'
  | 'deadline_t7'
  | 'deadline_t2'
  | 'deadline_t0'
  | 'opens_soon'
  | 'followup_1'
  | 'followup_2';

export interface PlannedReminder {
  target_type: TargetType;
  target_id: number;
  kind: ReminderKind;
  /** UTC ISO. */
  due_at: string;
}

export interface TrackedOpportunity {
  id: number;
  deadline_at: string | null;
  deadline_status: string;
  starred: boolean;
  in_pipeline: boolean;
  dismissed: boolean;
  closed: boolean;
}

export interface TrackedProgram {
  id: number;
  status: string;
  expected_open_at: string | null;
  expected_deadline_at: string | null;
}

export interface TrackedPipelineRow {
  id: number;
  status: string;
  sent_at: string | null;
  followup1_at: string | null;
  followup2_at: string | null;
}

export interface PlanningState {
  opportunities: readonly TrackedOpportunity[];
  programs: readonly TrackedProgram[];
  pipeline: readonly TrackedPipelineRow[];
  /** Deadlines added by hand: always reminded. Optional so older callers keep working. */
  manual?: readonly { id: number; deadline_at: string }[];
}

/** 09:00 local on the day `days` away from `from` (negative = before). */
export function localMorning(from: Date, days: number, timeZone: string): string {
  const d = addLocalDays(from, days, timeZone);
  return zonedToUtc(d.year, d.month, d.day, REMINDER_HOUR, 0, 0, 0, timeZone).toISOString();
}

export const deadlineKind = (offset: number) => `deadline_t${offset}` as ReminderKind;
export const isDeadlineKind = (kind: string) => kind.startsWith('deadline_t');

export function deadlineReminders(
  target_type: TargetType,
  target_id: number,
  deadlineAt: string,
  timeZone: string,
): PlannedReminder[] {
  const deadline = new Date(deadlineAt);
  return DEADLINE_OFFSETS.map((n) => ({
    target_type,
    target_id,
    kind: deadlineKind(n),
    due_at: localMorning(deadline, -n, timeZone),
  }));
}

/** Follow-up dates for a row sent at `sentAt`: 09:00 local, +7 and +14 days. */
export function followupDates(sentAt: string, timeZone: string): [string, string] {
  const sent = new Date(sentAt);
  return [
    localMorning(sent, FOLLOWUP_DAYS[0], timeZone),
    localMorning(sent, FOLLOWUP_DAYS[1], timeZone),
  ];
}

const PROGRAM_ACTIVE = new Set(['watching', 'open']);

/**
 * Every reminder that should exist for the tracked items, whatever the current time. The store
 * inserts the future ones and removes unfired ones that are no longer in this list.
 */
export function canonicalReminders(state: PlanningState, timeZone: string): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const o of state.opportunities) {
    const tracked = (o.starred || o.in_pipeline) && !o.dismissed && !o.closed;
    if (!tracked || !o.deadline_at || o.deadline_status !== 'confirmed') continue;
    out.push(...deadlineReminders('opportunity', o.id, o.deadline_at, timeZone));
  }
  for (const p of state.programs) {
    if (!PROGRAM_ACTIVE.has(p.status)) continue;
    if (p.expected_open_at) {
      out.push({
        target_type: 'program',
        target_id: p.id,
        kind: 'opens_soon',
        due_at: localMorning(new Date(p.expected_open_at), -OPENS_SOON_DAYS, timeZone),
      });
    }
    if (p.expected_deadline_at) {
      out.push(...deadlineReminders('program', p.id, p.expected_deadline_at, timeZone));
    }
  }
  for (const m of state.manual ?? []) {
    out.push(...deadlineReminders('manual', m.id, m.deadline_at, timeZone));
  }
  for (const r of state.pipeline) {
    if (!r.sent_at) continue;
    const [f1, f2] = followupDates(r.sent_at, timeZone);
    if (r.status === 'sent') {
      out.push({
        target_type: 'pipeline',
        target_id: r.id,
        kind: 'followup_1',
        due_at: r.followup1_at ?? f1,
      });
    }
    if (r.status === 'sent' || r.status === 'followup_sent') {
      out.push({
        target_type: 'pipeline',
        target_id: r.id,
        kind: 'followup_2',
        due_at: r.followup2_at ?? f2,
      });
    }
  }
  return out;
}

export const reminderKey = (
  r: Pick<PlannedReminder, 'target_type' | 'target_id' | 'kind' | 'due_at'>,
) => `${r.target_type}:${r.target_id}:${r.kind}:${r.due_at}`;

/** Reminder families for the catch-up rule: deadline offsets, "window opens soon", follow-ups. */
export const reminderFamily = (kind: string) =>
  isDeadlineKind(kind)
    ? 'deadline'
    : kind === 'opens_soon'
      ? 'opens'
      : kind.startsWith('followup_')
        ? 'followup'
        : null;

/**
 * Which canonical reminders to insert now: the future ones, plus a catch-up for a target that
 * starts being tracked late (starred five days before its deadline, or a program added a week
 * before its window opens): its most recent past reminder of that family, so the user hears
 * about it once. `known` holds "type:id:family" keys that already have reminder rows.
 */
export function remindersToInsert(
  canonical: readonly PlannedReminder[],
  now: Date,
  known: ReadonlySet<string>,
): PlannedReminder[] {
  const nowMs = now.getTime();
  const out = canonical.filter((r) => new Date(r.due_at).getTime() >= nowMs);
  const byTarget = new Map<string, PlannedReminder[]>();
  for (const r of canonical) {
    const family = reminderFamily(r.kind);
    if (!family) continue;
    const key = `${r.target_type}:${r.target_id}:${family}`;
    byTarget.set(key, [...(byTarget.get(key) ?? []), r]);
  }
  for (const [key, list] of byTarget) {
    if (known.has(key)) continue;
    const past = list.filter((r) => new Date(r.due_at).getTime() < nowMs);
    if (past.length === 0) continue;
    const latest = past.reduce((a, b) => (a.due_at > b.due_at ? a : b));
    if (latest.kind === 'opens_soon') {
      // Only while the window has not opened yet.
      const opensMs = new Date(latest.due_at).getTime() + OPENS_SOON_DAYS * 86_400_000;
      if (nowMs < opensMs) out.push(latest);
      continue;
    }
    if (latest.kind.startsWith('followup_')) {
      // Planned only while the row still waits for an answer, so a late one is still due.
      out.push(latest);
      continue;
    }
    // T-0 is due at 09:00 on the deadline day; the deadline itself is the end of that day.
    if (past.length === list.length && !stillOpen(list, nowMs)) continue;
    out.push(latest);
  }
  return out;
}

/** True while the T-0 reminder's day has not ended (deadline day, before midnight-ish). */
function stillOpen(list: readonly PlannedReminder[], nowMs: number): boolean {
  const t0 = list.find((r) => r.kind === 'deadline_t0');
  return t0 !== undefined && nowMs - new Date(t0.due_at).getTime() < 15 * 3_600_000;
}
