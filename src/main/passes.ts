// Runs the whole-table passes on the passes worker (see passes-worker.ts). If the worker cannot
// start or dies, the error is logged and passes run in the main process instead, in chunks with
// a turn of the event loop between them (slower for the window, but never silently skipped).
// No Electron imports: the worker's file path is passed in.
import { Worker } from 'node:worker_threads';
import type Database from 'better-sqlite3-multiple-ciphers';
import { runPassAsync, type PassJob, type PassResult } from '../core/passes';

export interface PassesDeps {
  /** The main process's connection, used by the fallback. */
  db: Database.Database;
  dbPath: string;
  key: Buffer;
  workerFile: string;
}

export interface Passes {
  run(job: PassJob): Promise<PassResult>;
  /** Closes the worker's connection and ends it. Resolves once it has exited. */
  close(): Promise<void>;
}

type Reply =
  { id: number; ok: true; result: PassResult } | { id: number; ok: false; error: string };

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export function createPasses(deps: PassesDeps): Passes {
  const pending = new Map<
    number,
    { job: PassJob; resolve: (r: PassResult) => void; reject: (e: Error) => void }
  >();
  let nextId = 1;
  let closing = false;
  let worker: Worker | null = null;
  let exited: Promise<void> = Promise.resolve();

  const giveUp = (why: string) => {
    if (!worker) return;
    worker = null;
    if (!closing) {
      console.error(`[passes] worker stopped (${why}); passes now run in the main process`);
    }
    // A pass the worker did not finish runs again here (chunks it wrote are simply redone).
    for (const p of pending.values()) {
      if (closing) p.reject(new Error(`Passes worker stopped: ${why}`));
      else runPassAsync(deps.db, p.job, nextTurn).then(p.resolve, p.reject);
    }
    pending.clear();
  };

  try {
    const w = new Worker(deps.workerFile, {
      workerData: { dbPath: deps.dbPath, key: new Uint8Array(deps.key) },
    });
    worker = w;
    exited = new Promise((resolve) => w.once('exit', () => resolve()));
    w.on('message', (reply: Reply) => {
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      if (reply.ok) p.resolve(reply.result);
      else p.reject(new Error(reply.error));
    });
    w.on('error', (err) => giveUp(err.message));
    w.on('exit', (code) => giveUp(`exit code ${code}`));
  } catch (err) {
    console.error('[passes] could not start the worker; passes run in the main process:', err);
  }

  return {
    run(job) {
      if (closing) return Promise.reject(new Error('Radar is locked'));
      const w = worker;
      if (!w) return runPassAsync(deps.db, job, nextTurn);
      const id = nextId++;
      return new Promise<PassResult>((resolve, reject) => {
        pending.set(id, { job, resolve, reject });
        w.postMessage({ id, job });
      });
    },

    async close() {
      closing = true;
      worker?.postMessage('close');
      await exited;
    },
  };
}
