import type {
  CopilotCheck,
  CopilotItem,
  CopilotStatus,
  Dimension,
  Grade,
} from '../../../shared/ipc';

/** One line under "Claude Code" in Settings after a check. */
export function checkLine(check: CopilotCheck): string {
  if (check.ok) {
    const took =
      check.durationMs === null ? '' : ` · answered in ${(check.durationMs / 1000).toFixed(1)} s`;
    return `${check.version || 'Claude Code'}${took}`;
  }
  switch (check.code) {
    case 'not-found':
      return 'Not found. Install Claude Code, or paste the path to claude.';
    case 'not-signed-in':
      return 'Not signed in. Run claude once in a terminal and log in.';
    case 'timeout':
      return 'No answer in time. Check your connection and try again.';
    default:
      return check.problem;
  }
}

/** Under "Master CV": how much is there. */
export function cvLine(cv: string): string {
  const words = cv.trim() ? cv.trim().split(/\s+/).length : 0;
  return words === 0
    ? 'Paste your full CV. Reviews and tailored CVs start from it.'
    : `${words.toLocaleString('en')} words · reviews and tailored CVs start from it`;
}

export const DIMENSION_LABELS: Record<Dimension, string> = {
  roleFit: 'Role fit',
  skills: 'Skills match',
  level: 'Level',
  location: 'Location and visa',
  language: 'Language',
  company: 'Company and team',
  growth: 'Growth',
  pay: 'Pay',
  odds: 'Interview odds',
  timing: 'Timing',
};

/** A and B are worth applying (green), C is borderline (amber), D and F are not (gray). */
export function gradeTone(grade: Grade): 'green' | 'amber' | 'gray' {
  if (grade === 'A' || grade === 'B') return 'green';
  return grade === 'C' ? 'amber' : 'gray';
}

export type ItemState = 'reviewed' | 'reviewing' | 'queued' | 'failed' | 'waiting';

export function itemState(
  item: CopilotItem,
  status: CopilotStatus | null,
  queued: boolean,
): ItemState {
  if (status?.current?.id === item.id) return 'reviewing';
  if (queued) return 'queued';
  if (status?.failures.some((f) => f.id === item.id)) return 'failed';
  return item.stored ? 'reviewed' : 'waiting';
}

export const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'waiting', label: 'Waiting' },
] as const;
export type FilterId = (typeof FILTERS)[number]['value'];

export function matchesFilter(item: CopilotItem, filter: FilterId, text: string): boolean {
  if (filter === 'reviewed' && !item.stored) return false;
  if (filter === 'waiting' && item.stored) return false;
  const q = text.trim().toLowerCase();
  return !q || `${item.title} ${item.org} ${item.location ?? ''}`.toLowerCase().includes(q);
}

/** Header line: what the queue is doing, or how many are reviewed. */
export function statusLine(items: readonly CopilotItem[], status: CopilotStatus | null): string {
  if (status?.running) {
    const now = status.current ? `Reviewing ${status.current.org}` : 'Starting';
    return status.queued.length > 0 ? `${now} · ${status.queued.length} more queued` : now;
  }
  const reviewed = items.filter((i) => i.stored).length;
  const waiting = items.length - reviewed;
  return `${reviewed} reviewed · ${waiting} waiting`;
}

/** "Reviewed Oct 20 · Sonnet" (local date). */
export function reviewedLine(reviewedAt: string, model: string, timeZone: string): string {
  const day = new Date(reviewedAt).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    timeZone,
  });
  return `Reviewed ${day}${model ? ` · ${model.charAt(0).toUpperCase()}${model.slice(1)}` : ''}`;
}
