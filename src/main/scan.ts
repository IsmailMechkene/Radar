// One scan at a time for the app. Runs in the main process (never a hidden window) with one
// shared HTTP client, so per-host rate limits and the ETag cache carry across scans.
// No Electron imports: the caller passes a broadcaster, which keeps this testable.
import type Database from 'better-sqlite3-multiple-ciphers';
import { latestFinishedRun, latestSuccessfulRun, type RunTrigger } from '../core/db/runs';
import type { HttpClient } from '../core/http/client';
import { runScan, scannableSources, type ScanSummary } from '../core/runner';
import type { ScanProgress, ScanStatus } from '../shared/ipc';

export interface ScanServiceDeps {
  db: Database.Database;
  http: HttpClient;
  now?: () => Date;
  onProgress?: (p: ScanProgress) => void;
  onFinished?: (s: ScanSummary) => void;
  /** Runs after storing and before onFinished (re-scoring), so listeners see scored rows. */
  afterScan?: () => void | Promise<void>;
}

export function createScanService(deps: ScanServiceDeps) {
  let running = false;
  let stopping = false;
  let current: Promise<unknown> = Promise.resolve();
  return {
    status(): ScanStatus {
      return {
        running,
        sourceCount: scannableSources(deps.db).length,
        lastRun: latestFinishedRun(deps.db) ?? null,
        lastSuccessAt: latestSuccessfulRun(deps.db)?.finished_at ?? null,
      };
    },

    async run(trigger: RunTrigger, only?: readonly string[]): Promise<ScanSummary> {
      if (stopping) throw new Error('Radar is locked');
      if (running) throw new Error('A scan is already running');
      running = true;
      const job = (async () => {
        try {
          const summary = await runScan(deps.db, {
            http: deps.http,
            trigger,
            only,
            now: deps.now,
            onSource: (outcome, done, total) => deps.onProgress?.({ outcome, done, total }),
            shouldStop: () => stopping,
          });
          if (stopping) return summary;
          await deps.afterScan?.();
          deps.onFinished?.(summary);
          return summary;
        } finally {
          running = false;
        }
      })();
      current = job.catch(() => undefined);
      return job;
    },

    /**
     * No new scans; a running one ends after its current source (what it stored is kept and
     * logged). Resolves once nothing runs, so the database can be closed.
     */
    async stop(): Promise<void> {
      stopping = true;
      await current;
    },
  };
}

export type ScanService = ReturnType<typeof createScanService>;
