// Passes worker: a worker thread of the main process with its own connection to the encrypted
// database. It runs deadline reading and re-scoring so the window's thread stays free; SQLite
// (WAL) lets it read while the scanner writes, and each chunk's writes are a short transaction.
// Messages: { id, job } -> { id, ok, result | error }; 'close' closes the database and exits.
import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../core/db/open';
import { runPass, type PassJob } from '../core/passes';

const port = parentPort;
if (!port) throw new Error('passes-worker must run as a worker thread');

const { dbPath, key } = workerData as { dbPath: string; key: Uint8Array };
const db = openDatabase(dbPath, Buffer.from(key));
// A scan stores a large board in one transaction: wait for it rather than fail.
db.pragma('busy_timeout = 60000');

port.on('message', (msg: { id: number; job: PassJob } | 'close') => {
  if (msg === 'close') {
    db.close();
    port.close();
    return;
  }
  try {
    port.postMessage({ id: msg.id, ok: true, result: runPass(db, msg.job) });
  } catch (err) {
    port.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
  }
});
