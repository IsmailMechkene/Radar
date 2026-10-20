import type Database from 'better-sqlite3-multiple-ciphers';
import { reviewInput, reviewQueue, reviewSchema, saveReview } from '../../core/copilot/reviews';
import { getAllSettings } from '../../core/settings/store';
import type { CopilotStatus } from '../../shared/ipc';
import { CopilotError, type RunResult } from './claude';
import { reviewPrompt } from './review';

/** After a scan, at most this many waiting postings are reviewed (best rule scores first). */
export const AUTO_REVIEW_LIMIT = 20;
/** Failures kept for the page (newest first). */
const MAX_FAILURES = 50;

/** Problems every posting would hit: the run stops at the first one. */
const FATAL = new Set(['not-found', 'not-signed-in', 'stopped']);

export interface CopilotRunner {
  run(args: {
    prompt: string;
    model: string;
    claudePath: string | null;
    signal: AbortSignal;
  }): Promise<RunResult<unknown>>;
}

export interface CopilotServiceDeps {
  db: Database.Database;
  runner: CopilotRunner;
  now?: () => Date;
  onChanged?: (s: CopilotStatus) => void;
}

export interface CopilotService {
  status(): CopilotStatus;
  /** Reviews these postings (again, if reviewed already). Rejects when Copilot cannot run. */
  review(ids: number[]): CopilotStatus;
  /** Every posting waiting for a review (or the best `limit`). */
  reviewWaiting(limit?: number): CopilotStatus;
  /** After a scan: new postings that passed the rules, when Copilot is on. Never throws. */
  afterScan(): void;
  /** Empties the queue and stops the review that is running. */
  stop(): Promise<void>;
}

export function createCopilotService(deps: CopilotServiceDeps): CopilotService {
  const { db, runner } = deps;
  const now = deps.now ?? (() => new Date());
  const queue: number[] = [];
  let current: CopilotStatus['current'] = null;
  let done = 0;
  let failures: CopilotStatus['failures'] = [];
  let lastError: string | null = null;
  let abort: AbortController | null = null;
  let loop: Promise<void> | null = null;

  const status = (): CopilotStatus => ({
    running: loop !== null,
    current,
    queued: [...queue],
    done,
    failures,
    lastError,
  });
  const changed = () => deps.onChanged?.(status());

  /** Why Copilot cannot run now, or null. */
  function blocker(): string | null {
    const s = getAllSettings(db);
    if (!s.copilot.enabled) return 'Turn on Radar Copilot in Settings first.';
    if (!s.masterCv.trim()) return 'Add your master CV in Settings > Radar Copilot first.';
    return null;
  }

  function enqueue(ids: number[]): void {
    for (const id of ids) if (!queue.includes(id) && current?.id !== id) queue.push(id);
    if (queue.length > 0 && !loop) {
      // A new run: earlier results stay on the page, the counts start again.
      done = 0;
      lastError = null;
      loop = drain().finally(() => {
        loop = null;
        current = null;
        changed();
      });
    }
    changed();
  }

  async function reviewOne(id: number, signal: AbortSignal): Promise<void> {
    const input = reviewInput(db, id);
    if (!input) return; // removed meanwhile
    current = { id, title: input.title, org: input.org };
    changed();
    const s = getAllSettings(db);
    const result = await runner.run({
      prompt: reviewPrompt(input, s, now()),
      model: s.copilot.model,
      claudePath: s.copilot.claudePath,
      signal,
    });
    const review = reviewSchema.parse(result.value);
    saveReview(db, input.dedupe_key, review, {
      model: s.copilot.model,
      costUsd: result.costUsd,
      at: now(),
    });
  }

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift()!;
      abort = new AbortController();
      try {
        await reviewOne(id, abort.signal);
        done += 1;
        failures = failures.filter((f) => f.id !== id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = err instanceof CopilotError ? err.code : 'failed';
        if (code !== 'stopped') {
          console.error(`[copilot] review of posting ${id} failed: ${message}`);
          failures = [{ id, problem: message }, ...failures.filter((f) => f.id !== id)].slice(
            0,
            MAX_FAILURES,
          );
        }
        lastError = code === 'stopped' ? null : message;
        if (FATAL.has(code)) queue.length = 0;
      } finally {
        abort = null;
        current = null;
        changed();
      }
    }
  }

  function start(ids: number[]): CopilotStatus {
    const why = blocker();
    if (why) throw new Error(why);
    enqueue(ids);
    return status();
  }

  return {
    status,
    review: (ids) => start(ids),
    reviewWaiting: (limit) => start(reviewQueue(db, limit)),
    afterScan() {
      try {
        const s = getAllSettings(db);
        if (!s.copilot.enabled) return;
        const why = blocker();
        if (why) {
          console.error(`[copilot] not reviewing new postings: ${why}`);
          lastError = why;
          changed();
          return;
        }
        // Postings that just failed are not retried on every scan; Review all retries them.
        const failed = new Set(failures.map((f) => f.id));
        enqueue(
          reviewQueue(db, AUTO_REVIEW_LIMIT + failed.size)
            .filter((id) => !failed.has(id))
            .slice(0, AUTO_REVIEW_LIMIT),
        );
      } catch (err) {
        console.error('[copilot] after-scan reviews could not start', err);
      }
    },
    async stop() {
      queue.length = 0;
      abort?.abort();
      await loop;
    },
  };
}
