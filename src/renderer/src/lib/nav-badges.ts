// Sidebar badges from the real counts. Pure, no component imports (tested in Node).
import type { NavCounts } from '../../../shared/ipc';
import type { Route } from './router';

/** Same tones as CountBadge. */
export type NavBadgeTone = 'accent' | 'amber' | 'red' | 'gray';

export interface NavBadge {
  text: string;
  tone: NavBadgeTone;
  /** Read by screen readers instead of the short text ("3 follow-ups due"). */
  label: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Sidebar badges from real counts; nothing to report shows no badge (design tones). */
export function navBadges(c: NavCounts | null): Partial<Record<Route, NavBadge>> {
  if (!c) return {};
  const out: Partial<Record<Route, NavBadge>> = {};
  if (c.newOpportunities > 0) {
    out.opportunities = {
      text: `${c.newOpportunities} new`,
      tone: 'accent',
      label: plural(c.newOpportunities, 'new opportunity', 'new opportunities'),
    };
  }
  if (c.deadlinesDue > 0) {
    out.deadlines = {
      text: `${c.deadlinesDue} due`,
      tone: 'amber',
      label: plural(c.deadlinesDue, 'item due soon', 'items due soon'),
    };
  }
  if (c.followupsDue > 0) {
    out.pipeline = {
      text: String(c.followupsDue),
      tone: 'amber',
      label: plural(c.followupsDue, 'follow-up due', 'follow-ups due'),
    };
  }
  if (c.programsChanged > 0) {
    out.programs = {
      text: String(c.programsChanged),
      tone: 'gray',
      label: plural(c.programsChanged, 'program page changed', 'program pages changed'),
    };
  }
  if (c.sourcesBroken > 0) {
    out.sources = {
      text: String(c.sourcesBroken),
      tone: 'red',
      label: plural(c.sourcesBroken, 'source looks broken', 'sources look broken'),
    };
  }
  return out;
}
