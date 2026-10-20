// The whole-table passes (deadline reading, re-scoring) as plain messages, so the app can run
// them on the passes worker (its own connection, off the window's thread) or, as a fallback, in
// the main process. Time zone and scoring profile are read from the database the pass runs on.
import type Database from 'better-sqlite3-multiple-ciphers';
import type { PassScope } from './chunks';
import {
  extractDeadlines,
  extractDeadlinesAsync,
  type DeadlineExtraction,
} from './deadlines/postings';
import { compileRules } from './rules/engine';
import { profileFromSettings } from './rules/profile';
import { rescoreAll, rescoreAllAsync, type RescoreResult } from './rules/rescore';
import type { Rules } from './rules/schema';
import { getAllSettings, getSetting } from './settings/store';

export type PassJob =
  | { kind: 'deadlines'; scope: PassScope }
  /** `now` is an ISO timestamp (scores depend on posting age and days to the deadline). */
  | { kind: 'rescore'; scope: PassScope; rules: Rules; now: string };

export type PassResult =
  { kind: 'deadlines'; result: DeadlineExtraction } | { kind: 'rescore'; result: RescoreResult };

/** Runs a pass straight through (the passes worker: nothing else waits on its thread). */
export function runPass(db: Database.Database, job: PassJob): PassResult {
  if (job.kind === 'deadlines') {
    return {
      kind: 'deadlines',
      result: extractDeadlines(db, getSetting(db, 'timezone'), job.scope),
    };
  }
  const profile = profileFromSettings(getAllSettings(db));
  return {
    kind: 'rescore',
    result: rescoreAll(db, compileRules(job.rules), profile, new Date(job.now), job.scope),
  };
}

/** Same pass, awaiting `pause` between chunks (in the main process, when the worker is gone). */
export async function runPassAsync(
  db: Database.Database,
  job: PassJob,
  pause: () => Promise<void>,
): Promise<PassResult> {
  if (job.kind === 'deadlines') {
    const tz = getSetting(db, 'timezone');
    return { kind: 'deadlines', result: await extractDeadlinesAsync(db, tz, pause, job.scope) };
  }
  const profile = profileFromSettings(getAllSettings(db));
  const rules = compileRules(job.rules);
  const now = new Date(job.now);
  return {
    kind: 'rescore',
    result: await rescoreAllAsync(db, rules, profile, now, pause, job.scope),
  };
}
