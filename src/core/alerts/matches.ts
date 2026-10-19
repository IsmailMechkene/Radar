// New-match alerts (after scans and on the hourly tick). Every posting is considered once: those
// that qualify are alerted (now, or in the daily summary), the rest are marked handled at once, so
// a later re-score or another source finding the posting never brings an old one back. Quiet hours
// hold alerts (never drop them); the next tick after they end sends them.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { isQuietTime } from '../reminders/quiet';
import type { Settings } from '../settings/schema';
import { getSetting, setSetting } from '../settings/store';
import { zonedParts } from '../time';

export type MatchAlertMode = Settings['matchAlerts'];

/** Local hour of the daily summary (the reminders' time too). */
export const DIGEST_HOUR = 9;

export interface MatchAlert {
  /** The postings in this alert, best score first (the Opportunities page shows exactly these). */
  ids: number[];
  title: string;
  body: string;
}

export interface MatchAlertResult {
  alert: MatchAlert | null;
  /** Qualifying postings held for later (quiet hours, or waiting for the daily summary). */
  deferred: number;
}

const pendingRow = z.object({
  id: z.int(),
  title: z.string(),
  org: z.string(),
  location: z.string().nullable(),
  score: z.number().nullable(),
  verdict: z.string().nullable(),
  opportunity_type: z.string(),
  open: z.union([z.literal(0), z.literal(1)]),
  in_pipeline: z.union([z.literal(0), z.literal(1)]),
  sample: z.union([z.literal(0), z.literal(1)]),
});
type Pending = z.output<typeof pendingRow>;

function pending(db: Database.Database): Pending[] {
  return db
    .prepare(
      `SELECT o.id, o.title, o.org, o.location, o.score, o.verdict, o.opportunity_type,
              (o.closed_at IS NULL AND o.dismissed_at IS NULL) AS open,
              EXISTS (SELECT 1 FROM pipeline p WHERE p.opportunity_id = o.id) AS in_pipeline,
              (s.kind = 'sample') AS sample
         FROM opportunities o JOIN sources s ON s.id = o.source_id
        WHERE o.alerted_at IS NULL`,
    )
    .all()
    .map((r) => pendingRow.parse(r));
}

/** Whether a scored posting is worth an alert in this mode. */
function qualifies(p: Pending, mode: MatchAlertMode): boolean {
  if (!p.open || p.in_pipeline || p.sample || p.opportunity_type === 'program') return false;
  if (mode === 'off') return false;
  return p.verdict === 'apply' || (mode === 'apply_maybe' && p.verdict === 'maybe');
}

/** Not scored yet (a scan stored it, the re-score has not run): decide on a later call. */
const unscored = (p: Pending) =>
  p.verdict === null && !p.sample && p.opportunity_type !== 'program';

/** "Datadog · Applied Science Intern (Paris, France) — 77" */
function line(p: Pending): string {
  const where = p.location ? ` (${p.location})` : '';
  return `${p.org} · ${p.title}${where}${p.score === null ? '' : ` — ${Math.round(p.score)}`}`;
}

export function matchAlertText(
  items: readonly Pending[],
  mode: MatchAlertMode,
): { title: string; body: string } {
  const strong = items.filter((p) => p.verdict === 'apply').length;
  const n = items.length;
  const title =
    mode === 'apply_maybe' && strong < n
      ? `${n} new match${n === 1 ? '' : 'es'}${strong ? ` (${strong} strong)` : ''}`
      : n === 1
        ? 'New strong match'
        : `${n} new strong matches`;
  const shown = items.slice(0, 3).map(line);
  if (n > 3) shown.push(`and ${n - 3} more`);
  return {
    title: mode === 'daily' ? `Today: ${title.toLowerCase()}` : title,
    body: shown.join('\n'),
  };
}

/** Local calendar day "YYYY-MM-DD" of an instant. */
function localDay(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export interface MatchAlertOptions {
  mode: MatchAlertMode;
  now: Date;
  timeZone: string;
  quietHours: Settings['quietHours'];
  /** When the last daily summary went out (settings matchDigestAt). */
  lastDigestAt: string | null;
}

/**
 * Takes the alert that is due, marking what it covers (and every posting that does not qualify)
 * as handled. Returns null when nothing is due; `deferred` counts what is held for later.
 */
export function takeMatchAlerts(
  db: Database.Database,
  o: MatchAlertOptions,
): MatchAlertResult & { digestSent: boolean } {
  const rows = pending(db);
  const at = o.now.toISOString();
  const mark = db.prepare('UPDATE opportunities SET alerted_at = ? WHERE id = ?');
  const handle = (ps: readonly Pending[]) =>
    db.transaction(() => {
      for (const p of ps) mark.run(at, p.id);
    })();

  const ready = rows.filter((p) => !unscored(p));
  handle(ready.filter((p) => !qualifies(p, o.mode)));
  const matches = ready
    .filter((p) => qualifies(p, o.mode))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id - b.id);
  const none = { alert: null, deferred: 0, digestSent: false };
  if (matches.length === 0) return none;
  if (isQuietTime(o.now, o.quietHours, o.timeZone)) return { ...none, deferred: matches.length };

  if (o.mode === 'daily') {
    const today = localDay(o.now, o.timeZone);
    const sentToday =
      o.lastDigestAt !== null && localDay(new Date(o.lastDigestAt), o.timeZone) === today;
    if (zonedParts(o.now, o.timeZone).hour < DIGEST_HOUR || sentToday) {
      return { ...none, deferred: matches.length };
    }
  }
  handle(matches);
  return {
    alert: { ids: matches.map((p) => p.id), ...matchAlertText(matches, o.mode) },
    deferred: 0,
    digestSent: o.mode === 'daily',
  };
}

/** takeMatchAlerts with the user's settings; records when a daily summary went out. */
export function dueMatchAlerts(db: Database.Database, now: Date): MatchAlertResult {
  const r = takeMatchAlerts(db, {
    mode: getSetting(db, 'matchAlerts'),
    now,
    timeZone: getSetting(db, 'timezone'),
    quietHours: getSetting(db, 'quietHours'),
    lastDigestAt: getSetting(db, 'matchDigestAt'),
  });
  if (r.digestSent) setSetting(db, 'matchDigestAt', now.toISOString());
  return { alert: r.alert, deferred: r.deferred };
}
