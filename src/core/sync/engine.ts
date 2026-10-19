// One sync round: pull what is new on the account and apply it, then push this device's change
// log. Last writer wins per row (by change time); the server keeps only the newest version of a
// row too (sync_push). Pulled records are checked against their id and validated before writing;
// a record that fails is reported and skipped, never applied half-way. No Electron imports.
import type Database from 'better-sqlite3-multiple-ciphers';
import { z } from 'zod';
import { ENTITIES, applyRow, isEntity, readRow, relinkPipeline, type Entity } from './entities';
import { recordId, seal, unseal, type SyncKeys } from './crypto';
import {
  clearChanges,
  deviceId,
  dropChange,
  getState,
  pendingChange,
  pendingChanges,
  quietly,
  setState,
  type Change,
} from './state';

/** A stored record as the server returns it. */
export interface RemoteRecord {
  id: string;
  seq: number;
  ciphertext: string;
}

export interface OutgoingRecord {
  id: string;
  updatedAt: string;
  ciphertext: string;
}

/** The account's record store (Supabase in the app, a fake in tests). */
export interface SyncRemote {
  /** Records with seq > after, in seq order. */
  pull(after: number, limit: number): Promise<RemoteRecord[]>;
  /** Stores records that are at least as new as the stored ones. */
  push(records: OutgoingRecord[]): Promise<void>;
}

/** What is inside each ciphertext. */
const envelopeSchema = z.object({
  v: z.literal(1),
  entity: z.string(),
  key: z.string().min(1),
  /** The row, or null for a deletion. */
  row: z.unknown().nullable(),
  updatedAt: z.iso.datetime(),
  device: z.string(),
});
type Envelope = z.output<typeof envelopeSchema>;

export interface SyncResult {
  pulled: number;
  applied: number;
  pushed: number;
  /** Records that could not be read or applied, with why. */
  failed: string[];
  /** Entities written here (to refresh what depends on them). */
  changed: Set<Entity>;
  /** Synced settings written here. */
  settings: string[];
}

export const PULL_BATCH = 500;
export const PUSH_BATCH = 200;

export interface SyncOptions {
  keys: SyncKeys;
  now?: () => Date;
}

const order = (c: Change) =>
  (c.deleted ? ENTITIES.length : 0) + ENTITIES.indexOf(c.entity as Entity);

export async function syncOnce(
  db: Database.Database,
  remote: SyncRemote,
  options: SyncOptions,
): Promise<SyncResult> {
  const now = options.now ?? (() => new Date());
  const { keys } = options;
  const device = deviceId(db);
  const result: SyncResult = {
    pulled: 0,
    applied: 0,
    pushed: 0,
    failed: [],
    changed: new Set(),
    settings: [],
  };

  // --- Pull ------------------------------------------------------------------------------
  for (;;) {
    const cursor = Number(getState(db, 'cursor') ?? '0');
    const batch = await remote.pull(cursor, PULL_BATCH);
    if (batch.length === 0) break;
    quietly(db, () => {
      for (const record of batch) {
        result.pulled += 1;
        try {
          applyRecord(db, keys, device, record, now(), result);
        } catch (err) {
          const why = err instanceof z.ZodError ? z.prettifyError(err) : String(err);
          result.failed.push(`record ${record.seq}: ${why}`);
        }
      }
      setState(db, 'cursor', String(batch[batch.length - 1]!.seq));
    });
    if (batch.length < PULL_BATCH) break;
  }
  if (result.changed.has('pipeline')) quietly(db, () => relinkPipeline(db));

  // --- Push ------------------------------------------------------------------------------
  // Parents before children and rows before deletions, so another device never meets a
  // deletion before the row that replaced it (see claim() in entities.ts).
  const changes = pendingChanges(db)
    .filter((c) => {
      if (isEntity(c.entity)) return true;
      dropChange(db, c.entity, c.key); // from a newer Radar that knew more entities: not ours
      return false;
    })
    .sort((a, b) => order(a) - order(b));
  for (let i = 0; i < changes.length; i += PUSH_BATCH) {
    const chunk = changes.slice(i, i + PUSH_BATCH);
    const records: OutgoingRecord[] = [];
    for (const c of chunk) {
      const entity = c.entity as Entity;
      const row = c.deleted ? null : readRow(db, entity, c.key);
      // A row that is gone without a deletion (or stopped syncing) has nothing to send.
      if (!c.deleted && row === null) continue;
      const id = recordId(keys, entity, c.key);
      const envelope: Envelope = {
        v: 1,
        entity,
        key: c.key,
        row,
        updatedAt: c.changed_at,
        device,
      };
      records.push({
        id,
        updatedAt: c.changed_at,
        ciphertext: seal(keys, id, JSON.stringify(envelope)),
      });
    }
    if (records.length > 0) await remote.push(records);
    clearChanges(db, chunk);
    result.pushed += records.length;
  }
  return result;
}

function applyRecord(
  db: Database.Database,
  keys: SyncKeys,
  device: string,
  record: RemoteRecord,
  now: Date,
  result: SyncResult,
): void {
  const envelope = envelopeSchema.parse(JSON.parse(unseal(keys, record.id, record.ciphertext)));
  if (!isEntity(envelope.entity)) {
    throw new Error(`unknown kind of row "${envelope.entity}" (from a newer Radar?)`);
  }
  // The id must be the one this row hashes to: the server cannot swap rows around.
  if (recordId(keys, envelope.entity, envelope.key) !== record.id) {
    throw new Error('record id does not match its contents');
  }
  if (envelope.device === device) return; // our own change coming back
  const local = pendingChange(db, envelope.entity, envelope.key);
  if (local && local.changed_at > envelope.updatedAt) return; // ours is newer and goes up next
  db.transaction(() => {
    const r = applyRow(db, envelope.entity as Entity, envelope.key, envelope.row, {
      now,
      changedAt: envelope.updatedAt,
    });
    if (local) dropChange(db, envelope.entity, envelope.key);
    if (r === 'applied') {
      result.applied += 1;
      result.changed.add(envelope.entity as Entity);
      if (envelope.entity === 'setting') result.settings.push(envelope.key);
    }
  })();
}
