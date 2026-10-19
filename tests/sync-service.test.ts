import type Database from 'better-sqlite3-multiple-ciphers';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { createPipelineRow, listPipeline } from '../src/core/db/pipeline';
import { seedDefaultSettings } from '../src/core/settings/store';
import { pendingCount } from '../src/core/sync/state';
import {
  createKeys,
  recoveryPartOf,
  type RecoveryPart,
  type ScryptParams,
} from '../src/core/vault/keys';
import { AccountError } from '../src/main/account/service';
import type { AccountRemote } from '../src/main/account/remote';
import { createSyncService } from '../src/main/sync';
import type { SyncStatus } from '../src/shared/ipc';
import { tempDb } from './helpers';

const FAST: ScryptParams = { N: 2 ** 10, r: 8, p: 1 };
const NOW = new Date('2026-10-19T09:00:00.000Z');
const TZ = 'Africa/Tunis';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** The account on the server: its vault and records, with switches for failures. */
function fakeAccount() {
  let vault: RecoveryPart | null = null;
  const rows = new Map<string, { seq: number; updatedAt: string; ciphertext: string }>();
  let seq = 0;
  const state = { failure: null as null | 'offline' | 'session-expired' };
  const check = () => {
    if (state.failure) throw new AccountError(state.failure, state.failure);
  };
  const remote: AccountRemote = {
    getVault: async () => (check(), vault),
    putVault: async (part) => {
      check();
      vault ??= part;
      return vault;
    },
    pull: async (after, limit) => {
      check();
      return [...rows.entries()]
        .map(([id, r]) => ({ id, seq: r.seq, ciphertext: r.ciphertext }))
        .filter((r) => r.seq > after)
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit);
    },
    push: async (records) => {
      check();
      for (const r of records) {
        const stored = rows.get(r.id);
        if (stored && stored.updatedAt > r.updatedAt) continue;
        rows.set(r.id, { seq: ++seq, updatedAt: r.updatedAt, ciphertext: r.ciphertext });
      }
    },
  };
  return { remote, state, rows, vault: () => vault };
}

/** A computer: its database and its own keys (data key, recovery key). */
async function computer(
  account: ReturnType<typeof fakeAccount>,
  opts: { confirmed?: boolean } = {},
) {
  const t = tempDb();
  cleanups.push(t.cleanup);
  migrate(t.db, () => NOW);
  seedDefaultSettings(t.db);
  const keys = await createKeys('a password 123', NOW, FAST);
  let part = recoveryPartOf(keys.file);
  const adopted: string[] = [];
  const statuses: SyncStatus[] = [];
  let applied = 0;
  const service = createSyncService({
    db: t.db,
    remote: account.remote,
    linked: () => true,
    recoveryInfo: () => ({ part, confirmed: opts.confirmed ?? true }),
    dataKey: keys.dataKey,
    adoptRecoveryKey: async (k) => {
      adopted.push(k);
      part = { ...part, salt: 'cmV3cmFwcGVk' }; // the wrapping changes; its content is not used here
    },
    onApplied: () => void (applied += 1),
    onStatus: (s) => void statuses.push(s),
    now: () => NOW,
    setTimeout: () => null,
    clearTimeout: () => {},
  });
  return {
    db: t.db as Database.Database,
    service,
    recoveryKey: keys.recoveryKey,
    adopted,
    statuses,
    applied: () => applied,
  };
}

describe('sync service', () => {
  it('the first computer gives the account its recovery wrapping and uploads', async () => {
    const account = fakeAccount();
    const a = await computer(account);
    createPipelineRow(a.db, { org: 'Spotify' }, TZ, NOW);
    const s = await a.service.now();
    expect(s).toMatchObject({ state: 'synced', pending: 0, message: null });
    expect(s.lastSyncedAt).toBe(NOW.toISOString());
    expect(account.vault()).not.toBeNull();
    expect(account.rows.size).toBe(1); // untouched defaults stay local
    await a.service.stop();
  });

  it('a computer with its own key waits for the account recovery key, then links and syncs', async () => {
    const account = fakeAccount();
    const a = await computer(account);
    createPipelineRow(a.db, { org: 'Spotify' }, TZ, NOW);
    await a.service.now();

    const b = await computer(account);
    expect(await b.service.now()).toMatchObject({ state: 'needs-recovery-key' });
    expect(listPipeline(b.db)).toEqual([]);
    await expect(b.service.useRecoveryKey(b.recoveryKey)).rejects.toThrow(/Wrong recovery key/);
    expect(b.adopted).toEqual([]);

    const s = await b.service.useRecoveryKey(a.recoveryKey);
    expect(s.state).toBe('synced');
    expect(b.adopted).toEqual([a.recoveryKey]); // one recovery key for both computers now
    expect(listPipeline(b.db).map((r) => r.org)).toEqual(['Spotify']);
    expect(b.applied()).toBe(1);
    // Linked for good: the next round does not ask again.
    expect(await b.service.now()).toMatchObject({ state: 'synced' });
  });

  it('offline or signed out, changes wait here and the status says why', async () => {
    const account = fakeAccount();
    const a = await computer(account);
    await a.service.now();
    createPipelineRow(a.db, { org: 'Offline Inc' }, TZ, NOW);
    account.state.failure = 'offline';
    expect(await a.service.now()).toMatchObject({ state: 'offline', pending: 1 });
    account.state.failure = 'session-expired';
    expect(await a.service.now()).toMatchObject({ state: 'signed-out', pending: 1 });
    account.state.failure = null;
    expect(await a.service.now()).toMatchObject({ state: 'synced', pending: 0 });
    expect(pendingCount(a.db)).toBe(0);
  });

  it('waits until the recovery key is saved before giving it to the account', async () => {
    const account = fakeAccount();
    const a = await computer(account, { confirmed: false });
    expect(await a.service.now()).toMatchObject({ state: 'off' });
    expect(account.vault()).toBeNull();
  });
});
