import type Database from 'better-sqlite3-multiple-ciphers';
import type { z } from 'zod';
import { hasTailoredCv, saveTailoredCv, tailoredCvSchema } from '../../core/copilot/cvs';
import {
  gradeOf,
  reviewInput,
  reviewOf,
  reviewQueue,
  reviewSchema,
  saveReview,
} from '../../core/copilot/reviews';
import { getAllSettings } from '../../core/settings/store';
import type { CopilotJob, CopilotStatus } from '../../shared/ipc';
import { CopilotError, type RunResult } from './claude';
import { cvPrompt } from './cv';
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
    schema: z.ZodType;
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
  /** Writes (again) the tailored CV of these postings. Rejects when Copilot cannot run. */
  makeCv(ids: number[]): CopilotStatus;
  /** After a scan: new postings that passed the rules, when Copilot is on. Never throws. */
  afterScan(): void;
  /** Empties the queue and stops the job that is running. */
  stop(): Promise<void>;
}

const same = (a: CopilotJob, b: CopilotJob) => a.id === b.id && a.kind === b.kind;

export function createCopilotService(deps: CopilotServiceDeps): CopilotService {
  const { db, runner } = deps;
  const now = deps.now ?? (() => new Date());
  const queue: CopilotJob[] = [];
  let current: CopilotStatus['current'] = null;
  let done = 0;
  let failures: CopilotStatus['failures'] = [];
  let lastError: string | null = null;
  let abort: AbortController | null = null;
  let loop: Promise<void> | null = null;

  const status = (): CopilotStatus => ({
    running: loop !== null,
    current,
    queued: queue.map((j) => ({ ...j })),
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

  function enqueue(jobs: CopilotJob[]): void {
    for (const job of jobs) {
      if (!queue.some((q) => same(q, job)) && !(current && same(current, job))) queue.push(job);
    }
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

  async function runJob(job: CopilotJob, signal: AbortSignal): Promise<void> {
    const input = reviewInput(db, job.id);
    if (!input) return; // removed meanwhile
    current = { ...job, title: input.title, org: input.org };
    changed();
    const s = getAllSettings(db);
    const common = { model: s.copilot.model, claudePath: s.copilot.claudePath, signal };
    if (job.kind === 'review') {
      const result = await runner.run({
        ...common,
        prompt: reviewPrompt(input, s, now()),
        schema: reviewSchema,
      });
      const review = reviewSchema.parse(result.value);
      saveReview(db, input.dedupe_key, review, {
        model: s.copilot.model,
        costUsd: result.costUsd,
        at: now(),
      });
      // Worth applying: the tailored CV follows, unless there is one already.
      const grade = gradeOf(Math.round(review.score * 10) / 10);
      if ((grade === 'A' || grade === 'B') && !hasTailoredCv(db, input.dedupe_key)) {
        enqueue([{ kind: 'cv', id: job.id }]);
      }
      return;
    }
    const result = await runner.run({
      ...common,
      prompt: cvPrompt(input, s, reviewOf(db, input.dedupe_key)),
      schema: tailoredCvSchema,
    });
    saveTailoredCv(db, input.dedupe_key, tailoredCvSchema.parse(result.value), {
      model: s.copilot.model,
      costUsd: result.costUsd,
      at: now(),
    });
  }

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const job = queue.shift()!;
      abort = new AbortController();
      try {
        await runJob(job, abort.signal);
        done += 1;
        failures = failures.filter((f) => !same(f, job));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = err instanceof CopilotError ? err.code : 'failed';
        if (code !== 'stopped') {
          console.error(`[copilot] ${job.kind} of posting ${job.id} failed: ${message}`);
          failures = [{ ...job, problem: message }, ...failures.filter((f) => !same(f, job))].slice(
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

  function start(jobs: CopilotJob[]): CopilotStatus {
    const why = blocker();
    if (why) throw new Error(why);
    enqueue(jobs);
    return status();
  }

  const reviews = (ids: number[]): CopilotJob[] => ids.map((id) => ({ kind: 'review', id }));

  return {
    status,
    review: (ids) => start(reviews(ids)),
    reviewWaiting: (limit) => start(reviews(reviewQueue(db, limit))),
    makeCv: (ids) => start(ids.map((id) => ({ kind: 'cv', id }))),
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
        const failed = new Set(failures.filter((f) => f.kind === 'review').map((f) => f.id));
        enqueue(
          reviews(
            reviewQueue(db, AUTO_REVIEW_LIMIT + failed.size)
              .filter((id) => !failed.has(id))
              .slice(0, AUTO_REVIEW_LIMIT),
          ),
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
