import {
  CalendarClock,
  Database,
  GraduationCap,
  Kanban,
  Radar,
  Send,
  Settings,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from '../lib/router';

export interface NavItem {
  route: Route;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const NAV_PRIMARY: readonly NavItem[] = [
  {
    route: 'opportunities',
    label: 'Opportunities',
    icon: Radar,
    description: 'Every result from every source, scored and sorted, with deadlines when known.',
  },
  {
    route: 'deadlines',
    label: 'Deadlines',
    icon: CalendarClock,
    description: 'Results that have a deadline, plus reminders that are due.',
  },
  {
    route: 'pipeline',
    label: 'Pipeline',
    icon: Kanban,
    description: 'Applications from not started to offer, with follow-up dates.',
  },
  {
    route: 'programs',
    label: 'Programs',
    icon: GraduationCap,
    description: 'Watched programs with their typical windows and change alerts.',
  },
  {
    route: 'outreach',
    label: 'Outreach',
    icon: Send,
    description: 'Email drafts with merge fields. Radar never sends anything on its own.',
  },
];

export const NAV_SECONDARY: readonly NavItem[] = [
  {
    route: 'sources',
    label: 'Sources',
    icon: Database,
    description: 'Boards, feeds and pages Radar searches, with their health.',
  },
  {
    route: 'rules',
    label: 'Rules',
    icon: SlidersHorizontal,
    description: 'Keyword lists, weights and thresholds behind every score.',
  },
  {
    route: 'settings',
    label: 'Settings',
    icon: Settings,
    description: 'Profile, search preferences, appearance and startup.',
  },
];

export const NAV_ALL: readonly NavItem[] = [...NAV_PRIMARY, ...NAV_SECONDARY];

export function navItem(route: Route): NavItem | undefined {
  return NAV_ALL.find((n) => n.route === route);
}

export const ROUTE_TITLES: Record<Route, string> = {
  ...(Object.fromEntries(NAV_ALL.map((n) => [n.route, n.label])) as Record<Route, string>),
  components: 'Components',
};
