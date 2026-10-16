// "Due soon": the rule shared by the Deadlines page column and the sidebar count. Pure.
import { localDaysBetween } from '../time';
import type { DeadlineEvent, DueFollowup } from './list';

export type DueItem =
  | { kind: 'event'; key: string; at: string; event: DeadlineEvent }
  | { kind: 'followup'; key: string; at: string; followup: DueFollowup };

/**
 * Tracked deadlines and window openings in the next 14 days (overdue ones from the last week),
 * not done or snoozed, plus follow-ups that are due. Oldest first.
 */
export function dueSoon(
  events: readonly DeadlineEvent[],
  followups: readonly DueFollowup[],
  now: Date,
  timeZone: string,
): DueItem[] {
  const items: DueItem[] = [];
  for (const e of events) {
    if (!e.tracked || e.done) continue;
    if (e.snoozed_until && new Date(e.snoozed_until).getTime() > now.getTime()) continue;
    const d = localDaysBetween(now, new Date(e.at), timeZone);
    const inWindow = e.event === 'deadline' ? d >= -7 && d <= 14 : d >= 0 && d <= 14;
    if (inWindow) items.push({ kind: 'event', key: e.key, at: e.at, event: e });
  }
  for (const f of followups)
    items.push({ kind: 'followup', key: f.key, at: f.due_at, followup: f });
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
