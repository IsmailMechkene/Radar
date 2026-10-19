// Display rules for the Sources page. Pure: the clock is passed in.
import type { SourceHealth, SourceItem } from '../../../core/sources/manage';

export type AccessMethod = SourceItem['access_method'];

/** Design group order and names. */
export const GROUPS: { method: AccessMethod; label: string }[] = [
  { method: 'api', label: 'API' },
  { method: 'rss', label: 'RSS' },
  { method: 'public_html', label: 'Public page' },
  { method: 'email_alert', label: 'Email alerts' },
  { method: 'manual', label: 'Manual' },
];

export function groupSources(items: readonly SourceItem[]) {
  return GROUPS.map((g) => ({
    ...g,
    items: items.filter((s) => s.access_method === g.method),
  })).filter((g) => g.items.length > 0);
}

export const HEALTH_LABEL: Record<SourceHealth, string> = {
  healthy: 'Healthy',
  warning: 'Returned nothing last time',
  broken: 'Looks broken',
  paused: 'Paused',
  unavailable: 'Not available yet',
  new: 'Not run yet',
};

/** StatusDot tones (the design's ok / warn / bad / off). */
export const HEALTH_DOT: Record<SourceHealth, 'healthy' | 'slow' | 'broken' | 'paused'> = {
  healthy: 'healthy',
  warning: 'slow',
  broken: 'broken',
  paused: 'paused',
  unavailable: 'paused',
  new: 'paused',
};

const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

/** The line under the name: what the source is. */
export function sourceDetail(s: SourceItem): string {
  if (s.health === 'unavailable' && s.note) return s.note;
  if (s.kind === 'ashby') return `Ashby job board · ${String(s.config['board'] ?? '')}`;
  if (s.kind === 'greenhouse') return `Greenhouse job board · ${String(s.config['board'] ?? '')}`;
  if (s.kind === 'lever') return `Lever job board · ${String(s.config['site'] ?? '')}`;
  if (s.kind === 'recruitee') return `Recruitee careers site · ${String(s.config['board'] ?? '')}`;
  if (s.kind === 'arbeitnow') return 'Arbeitnow job board API';
  if (s.kind === 'page') {
    const where = s.url ? host(s.url) : 'no page yet';
    return s.program ? `Program page · ${where}` : where;
  }
  return s.url ? host(s.url) : s.kind;
}

/** "Just now", "14 min ago", "3 h ago", "2 days ago", "Never". */
export function lastRun(iso: string | null, now: Date): string {
  if (!iso) return 'Never';
  const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export interface ErrorLine {
  text: string;
  tone: 'muted' | 'amber' | 'red';
}

export function errorLine(s: SourceItem): ErrorLine {
  if (s.last_error) return { text: s.last_error, tone: 'red' };
  if (s.health === 'unavailable') return { text: 'Waiting for an adapter', tone: 'muted' };
  if (s.consecutive_empty > 0) {
    const runs = s.consecutive_empty;
    return {
      text: `Nothing found ${runs} ${runs === 1 ? 'run' : 'runs'} in a row`,
      tone: s.health === 'broken' ? 'red' : 'amber',
    };
  }
  return { text: '—', tone: 'muted' };
}

/** The red note under a broken row (design: "Returned nothing for 3 runs."). */
export function brokenNote(s: SourceItem): { title: string; detail: string } | null {
  if (s.health !== 'broken') return null;
  if (s.last_error) {
    return {
      title: 'The last fetch failed.',
      detail: 'Test fetch to see the error now; pause it if the site is down for a while.',
    };
  }
  return {
    title: `Returned nothing for ${s.consecutive_empty} runs.`,
    detail: 'The board may be empty or its address changed. Test fetch to see what it returns.',
  };
}

/** "9 sources · 6 healthy · 1 broken · 1 paused" */
export function sourcesSubtitle(items: readonly SourceItem[]): string {
  const n = (h: SourceHealth) => items.filter((s) => s.health === h).length;
  const parts = [
    `${items.length} ${items.length === 1 ? 'source' : 'sources'}`,
    `${n('healthy')} healthy`,
  ];
  if (n('warning')) parts.push(`${n('warning')} returned nothing`);
  if (n('broken')) parts.push(`${n('broken')} broken`);
  if (n('paused')) parts.push(`${n('paused')} paused`);
  if (n('unavailable')) parts.push(`${n('unavailable')} not available yet`);
  return parts.join(' · ');
}
