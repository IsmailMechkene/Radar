// Runs end-to-end encrypted sync while Radar is unlocked and linked to an account: a round on
// start, whenever local changes wait (checked every few seconds), and a pull every minute for
// changes from other devices. Offline or signed out, it waits and retries; nothing is lost because
// the change log stays until a push succeeds. No Electron imports (timers and deps injected).
import type Database from 'better-sqlite3-multiple-ciphers';
import { syncKeys, syncRoot } from '../core/sync/crypto';
import { syncOnce, type SyncResult } from '../core/sync/engine';
import { getState, pendingCount, setState } from '../core/sync/state';
import { sameRecoveryPart, unwrapRecoveryPart, type RecoveryPart } from '../core/vault/keys';
import type { SyncStatus } from '../shared/ipc';
import { AccountError } from './account/service';
import type { AccountRemote } from './account/remote';

export const SYNC_CHECK_MS = 10_000;
export const SYNC_PULL_MS = 60_000;
export const SYNC_RETRY_MS = 60_000;
export const SYNC_SIGNED_OUT_RETRY_MS = 5 * 60_000;

export interface SyncServiceDeps {
  db: Database.Database;
  remote: AccountRemote;
  /** The data here is linked to an account (sync waits until it is). */
  linked: () => boolean;
  /** keys.json's recovery wrapping and whether the user saved that key. */
  recoveryInfo: () => { part: RecoveryPart; confirmed: boolean } | null;
  /** This computer's data key (copied; wiped on stop). */
  dataKey: Buffer;
  /** Wraps this computer's data key with the account's recovery key (vault.adoptRecoveryKey). */
  adoptRecoveryKey: (recoveryKey: string) => Promise<unknown>;
  /** Rows from another device were written here. */
  onApplied: (result: SyncResult) => void;
  onStatus: (status: SyncStatus) => void;
  now?: () => Date;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export function createSyncService(deps: SyncServiceDeps) {
  const { db, remote } = deps;
  const now = deps.now ?? (() => new Date());
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const ownRoot = syncRoot(deps.dataKey);
  let timer: unknown = null;
  let stopped = false;
  let nextAt = 0;
  let current: SyncStatus = {
    state: 'off',
    lastSyncedAt: getState(db, 'synced_at'),
    pending: pendingCount(db),
    message: null,
  };

  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const next = queue.then(op, op);
    queue = next.catch(() => undefined);
    return next;
  };

  function set(next: Partial<SyncStatus>): SyncStatus {
    current = { ...current, pending: stopped ? current.pending : pendingCount(db), ...next };
    deps.onStatus(current);
    return current;
  }

  /**
   * The account's sync root: stored after the first round. The first device puts its recovery
   * wrapping on the account; a device whose wrapping matches the account's has the account's
   * data key; any other must link its data with the account's recovery key first.
   */
  async function accountRoot(): Promise<Buffer | null> {
    const stored = getState(db, 'root');
    if (stored) return Buffer.from(stored, 'hex');
    const local = deps.recoveryInfo();
    if (!local?.confirmed) {
      set({ state: 'off', message: 'Sync starts once the recovery key is saved' });
      return null;
    }
    const account = (await remote.getVault()) ?? (await remote.putVault(local.part));
    if (!sameRecoveryPart(account, local.part)) {
      set({
        state: 'needs-recovery-key',
        message:
          'The data on this computer was encrypted before it joined your account. Enter the recovery key you saved for your account to sync it.',
      });
      return null;
    }
    setState(db, 'root', ownRoot.toString('hex'));
    return Buffer.from(ownRoot);
  }

  async function round(): Promise<SyncStatus> {
    if (stopped) return current;
    if (!deps.linked()) return set({ state: 'off', message: null });
    try {
      const root = await accountRoot();
      if (!root || stopped) return current;
      set({ state: 'syncing' });
      const keys = syncKeys(root);
      root.fill(0);
      const r = await syncOnce(db, remote, { keys, now });
      if (stopped) return current;
      const at = now().toISOString();
      setState(db, 'synced_at', at);
      nextAt = now().getTime() + SYNC_PULL_MS;
      if (r.changed.size > 0) deps.onApplied(r);
      for (const f of r.failed) console.error(`[sync] skipped ${f}`);
      if (r.pulled + r.pushed > 0) {
        console.log(`[sync] pulled ${r.pulled} (${r.applied} applied), pushed ${r.pushed}`);
      }
      return set({
        state: 'synced',
        lastSyncedAt: at,
        message: r.failed.length
          ? `${r.failed.length} change${r.failed.length === 1 ? '' : 's'} from another device could not be applied (see the log)`
          : null,
      });
    } catch (err) {
      if (stopped) return current;
      const code = err instanceof AccountError ? err.code : 'other';
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'offline') {
        nextAt = now().getTime() + SYNC_RETRY_MS;
        return set({ state: 'offline', message: null });
      }
      if (code === 'session-expired') {
        nextAt = now().getTime() + SYNC_SIGNED_OUT_RETRY_MS;
        return set({ state: 'signed-out', message: 'Sign in again to sync' });
      }
      console.error('[sync] failed:', err);
      nextAt = now().getTime() + SYNC_RETRY_MS;
      return set({ state: 'error', message });
    }
  }

  function schedule(): void {
    if (stopped) return;
    timer = setT(() => void tick(), SYNC_CHECK_MS);
  }

  async function tick(): Promise<void> {
    timer = null;
    if (stopped) return;
    const waiting = current.state === 'needs-recovery-key';
    const due = now().getTime() >= nextAt;
    const changes = current.state === 'synced' && pendingCount(db) > 0;
    if (!waiting && (due || changes)) await serial(round);
    else if (!stopped && current.pending !== pendingCount(db)) set({});
    schedule();
  }

  return {
    status: (): SyncStatus => current,

    start(): void {
      stopped = false;
      void serial(round).finally(schedule);
    },

    /** "Sync now", or after waking up / coming back online. */
    now: () => serial(round),

    /**
     * Links data encrypted before joining: checks the recovery key against the account's, wraps
     * this computer's data key with it (one recovery key everywhere), then syncs.
     */
    useRecoveryKey: (recoveryKey: string) =>
      serial(async () => {
        const account = await remote.getVault();
        if (!account) throw new Error('No computer has synced this account yet');
        const key = unwrapRecoveryPart(account, recoveryKey);
        const root = syncRoot(key);
        key.fill(0);
        await deps.adoptRecoveryKey(recoveryKey);
        setState(db, 'root', root.toString('hex'));
        root.fill(0);
        return round();
      }),

    /** Stops timers and waits for a round in flight (before the database closes). */
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== null) clearT(timer);
      timer = null;
      await queue;
      ownRoot.fill(0);
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
