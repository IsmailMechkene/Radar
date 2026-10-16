// Background schedule for the app (SPEC section 8): a tick every hour, on startup and on wake
// from sleep. A tick scans when the last successful scan is too old, checks watched pages that
// are due, plans reminders and fires what is due. During quiet hours nothing is fired; a timer
// ticks again when they end. No Electron imports: notifications and timers are injected.
import type Database from 'better-sqlite3';
import { latestSuccessfulRun, type RunTrigger } from '../core/db/runs';
import { quietEndsAt } from '../core/reminders/quiet';
import { fireDue, syncReminders, type Notice } from '../core/reminders/store';
import { getSetting } from '../core/settings/store';

export const TICK_MS = 60 * 60 * 1000;
/** Startup and wake scan when the last good scan is older than this (or the interval setting). */
export const STALE_SCAN_HOURS = 12;

export type TickReason = 'startup' | 'resume' | 'hourly' | 'quiet-end';

export interface SchedulerDeps {
  db: Database.Database;
  now?: () => Date;
  scan: { run(trigger: RunTrigger): Promise<unknown>; status(): { running: boolean } };
  /** Checks watched pages that are due (page-change detection). */
  watchPages: () => Promise<void>;
  notify: (notice: Notice) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface TickResult {
  scanned: boolean;
  notices: number;
  deferred: number;
}

export function createScheduler(deps: SchedulerDeps) {
  const now = deps.now ?? (() => new Date());
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const setI = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearI = deps.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout));
  let interval: unknown = null;
  let quietTimer: unknown = null;
  let running: Promise<TickResult> | null = null;

  function scanIsStale(at: Date): boolean {
    const hours = Math.min(getSetting(deps.db, 'scanIntervalHours'), STALE_SCAN_HOURS);
    const last = latestSuccessfulRun(deps.db)?.finished_at;
    return !last || at.getTime() - new Date(last).getTime() > hours * 3_600_000;
  }

  async function run(reason: TickReason): Promise<TickResult> {
    const result: TickResult = { scanned: false, notices: 0, deferred: 0 };
    if (scanIsStale(now()) && !deps.scan.status().running) {
      try {
        await deps.scan.run(reason === 'startup' ? 'startup' : 'schedule');
        result.scanned = true;
      } catch (err) {
        console.error(`[scheduler] scan (${reason}) failed:`, err);
      }
    }
    try {
      await deps.watchPages();
    } catch (err) {
      console.error('[scheduler] page watch failed:', err);
    }

    const at = now();
    const timeZone = getSetting(deps.db, 'timezone');
    const quietHours = getSetting(deps.db, 'quietHours');
    let fired: ReturnType<typeof fireDue>;
    try {
      syncReminders(deps.db, at, timeZone);
      fired = fireDue(deps.db, at, { timeZone, quietHours });
    } catch (err) {
      console.error('[scheduler] reminders failed:', err);
      return result;
    }
    for (const n of fired.notices) {
      try {
        deps.notify(n);
      } catch (err) {
        console.error('[scheduler] notification failed:', err);
      }
    }
    result.notices = fired.notices.length;
    result.deferred = fired.deferred;
    if (fired.deferred > 0 && quietTimer === null) {
      const end = quietEndsAt(at, quietHours, timeZone);
      if (end) {
        quietTimer = setT(
          () => {
            quietTimer = null;
            void tick('quiet-end');
          },
          end.getTime() - at.getTime() + 1000,
        );
      }
    }
    console.log(
      `[scheduler] tick (${reason}): ${result.scanned ? 'scanned, ' : ''}${result.notices} notified, ${result.deferred} deferred`,
    );
    return result;
  }

  /** One tick at a time; a tick requested while one runs waits for it and returns its result. */
  function tick(reason: TickReason): Promise<TickResult> {
    if (running) return running;
    running = run(reason).finally(() => {
      running = null;
    });
    return running;
  }

  return {
    tick,
    start(): void {
      if (interval === null) interval = setI(() => void tick('hourly'), TICK_MS);
      void tick('startup');
    },
    stop(): void {
      if (interval !== null) clearI(interval);
      if (quietTimer !== null) clearT(quietTimer);
      interval = null;
      quietTimer = null;
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
