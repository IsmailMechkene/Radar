// Local lock state: no keys yet, locked, unlocked. Holds the data key only while unlocked and wipes
// it on lock. Accounts are layered on top (auth.ts). No Electron imports: opening and closing the
// unlocked part of the app are injected, which keeps this testable.
import { existsSync, statSync } from 'node:fs';
import { isPlainDatabase, resolveDbPath } from '../core/db/open';
import {
  confirmRecoveryKey,
  createKeys,
  linkAccount,
  readKeyFile,
  reissueRecoveryKey,
  rewrapPassword,
  unlockWithPassword,
  unlockWithRecoveryKey,
  writeKeyFile,
  type LinkedAccount,
  type ScryptParams,
} from '../core/vault/keys';

/** The local half of the lock (auth.ts adds the account). */
export type VaultStatus =
  /** No keys yet. `hasPlainData`: an unencrypted database will be encrypted. */
  | { state: 'setup'; hasPlainData: boolean }
  | { state: 'locked' }
  /** `recoveryKey` is set until the user confirms they saved it (shown once). */
  | { state: 'unlocked'; recoveryKey: string | null }
  /** The data cannot be opened (damaged or missing keys.json). */
  | { state: 'error'; message: string };

type AccountLink = Omit<LinkedAccount, 'linkedAt'>;

export interface VaultDeps {
  dataDir: string;
  now?: () => Date;
  /** Test hook: cheaper scrypt. */
  scrypt?: ScryptParams;
  /** Opens the database with the key and starts everything that needs it. Throws on failure. */
  open: (dataKey: Buffer) => Promise<void>;
  /** Stops everything, closes the database. */
  close: () => Promise<void>;
  /** Called after every state change (tray menu, renderer). */
  onChange?: (status: VaultStatus) => void;
}

export function createVault(deps: VaultDeps) {
  const now = deps.now ?? (() => new Date());
  let dataKey: Buffer | null = null;
  // The recovery key waiting for "I saved it"; it exists only in memory.
  let pendingRecovery: string | null = null;
  // One operation at a time (a double-click on Unlock, Lock during an unlock, ...).
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const next = queue.then(op, op);
    queue = next.catch(() => undefined);
    return next;
  };

  function status(): VaultStatus {
    if (dataKey) return { state: 'unlocked', recoveryKey: pendingRecovery };
    try {
      if (readKeyFile(deps.dataDir)) return { state: 'locked' };
    } catch (err) {
      return { state: 'error', message: err instanceof Error ? err.message : String(err) };
    }
    const dbPath = resolveDbPath(deps.dataDir);
    if (existsSync(dbPath) && statSync(dbPath).size > 0 && !isPlainDatabase(dbPath)) {
      return {
        state: 'error',
        message: `${dbPath} is encrypted but keys.json is missing next to it. Put keys.json back to open it.`,
      };
    }
    return { state: 'setup', hasPlainData: isPlainDatabase(dbPath) };
  }

  function changed(): VaultStatus {
    const s = status();
    deps.onChange?.(s);
    return s;
  }

  async function openWith(key: Buffer): Promise<void> {
    try {
      await deps.open(key);
    } catch (err) {
      key.fill(0);
      pendingRecovery = null;
      throw err;
    }
    dataKey = key;
  }

  function keyFileOrThrow() {
    const file = readKeyFile(deps.dataDir);
    if (!file) throw new Error('Radar has no password yet');
    return file;
  }

  return {
    status,

    /**
     * First run: a password, a new data key and recovery key; existing data gets encrypted. With an
     * account, the data is linked to it from the start.
     */
    setup: (password: string, account?: AccountLink) =>
      serial(async () => {
        const s = status();
        if (s.state !== 'setup') throw new Error('Radar already has a password');
        const keys = await createKeys(password, now(), deps.scrypt);
        writeKeyFile(deps.dataDir, account ? linkAccount(keys.file, account, now()) : keys.file);
        pendingRecovery = keys.recoveryKey;
        await openWith(keys.dataKey);
        return changed();
      }),

    unlock: (password: string) =>
      serial(async () => {
        if (dataKey) return status();
        let file = keyFileOrThrow();
        const key = await unlockWithPassword(file, password);
        // A recovery key that was never confirmed may not have been saved: issue a new one.
        if (!file.recovery.confirmedAt) {
          const r = reissueRecoveryKey(file, key);
          file = r.file;
          writeKeyFile(deps.dataDir, file);
          pendingRecovery = r.recoveryKey;
        }
        await openWith(key);
        return changed();
      }),

    /** Forgot password: the recovery key opens the data; the new password replaces the old one. */
    recover: (recoveryKey: string, newPassword: string) =>
      serial(async () => {
        if (dataKey) throw new Error('Radar is already unlocked');
        const file = keyFileOrThrow();
        const key = unlockWithRecoveryKey(file, recoveryKey);
        const next = await rewrapPassword(file, key, newPassword, deps.scrypt);
        // The recovery key just worked, so the user has it.
        writeKeyFile(
          deps.dataDir,
          next.recovery.confirmedAt ? next : confirmRecoveryKey(next, now()),
        );
        await openWith(key);
        return changed();
      }),

    confirmRecoveryKey: () =>
      serial(async () => {
        if (!dataKey) throw new Error('Radar is locked');
        writeKeyFile(deps.dataDir, confirmRecoveryKey(keyFileOrThrow(), now()));
        pendingRecovery = null;
        return changed();
      }),

    lock: () =>
      serial(async () => {
        if (!dataKey) return status();
        const key = dataKey;
        dataKey = null;
        pendingRecovery = null;
        // The lock screen shows right away; work in flight drains before the database closes.
        changed();
        try {
          await deps.close();
        } finally {
          key.fill(0);
        }
        return status();
      }),

    /** Links the open data to an account (a computer set up before accounts existed). */
    linkAccount: (account: AccountLink) =>
      serial(async () => {
        if (!dataKey) throw new Error('Radar is locked');
        writeKeyFile(deps.dataDir, linkAccount(keyFileOrThrow(), account, now()));
        return changed();
      }),

    /** While unlocked: the same data key under a new password (the account password changed). */
    changePassword: (password: string) =>
      serial(async () => {
        if (!dataKey) throw new Error('Radar is locked');
        writeKeyFile(
          deps.dataDir,
          await rewrapPassword(keyFileOrThrow(), dataKey, password, deps.scrypt),
        );
        return status();
      }),

    /** Throws WrongSecretError unless this recovery key opens the data. Opens nothing. */
    checkRecoveryKey: (recoveryKey: string) => {
      unlockWithRecoveryKey(keyFileOrThrow(), recoveryKey).fill(0);
    },

    /** The account the data is linked to, if any (null when there are no keys or none is linked). */
    account: (): LinkedAccount | null => {
      try {
        return readKeyFile(deps.dataDir)?.account ?? null;
      } catch {
        return null; // a damaged file is reported by status()
      }
    },

    isUnlocked: () => dataKey !== null,
  };
}

export type Vault = ReturnType<typeof createVault>;
