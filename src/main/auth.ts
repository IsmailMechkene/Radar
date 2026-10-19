// Sign-in and unlock, together: the online account (Supabase) and the local vault (the data key).
// Decides which login screen shows (status) and runs each flow one at a time. No Electron imports:
// the vault, the account service, the callback server and the browser are injected.
//
// Rules:
// - Email users: the account password is also the password that encrypts the data here.
// - Google users: they choose a separate password for this computer after the first sign-in.
// - Unlocking needs no network once an account is linked and a session is stored; the session is
//   renewed in the background and retried while offline.
// - Data linked to one account never opens for another.
// - Forgot password (email users): the reset link sets the account password; the recovery key
//   re-encrypts the data here with it. The server never sees anything that opens the data.
import { WrongSecretError, passwordProblem, type LinkedAccount } from '../core/vault/keys';
import type { AccountInfo, AuthStatus, SessionState } from '../shared/ipc';
import { AccountError, type AccountService, type AccountUser } from './account/service';
import type { CallbackResult, CallbackServer } from './account/callback-server';
import type { Vault } from './vault';

/** Renew the session this often while unlocked, and retry this often while offline. */
export const SESSION_REFRESH_MS = 30 * 60_000;
export const SESSION_RETRY_MS = 60_000;

type Pending =
  | { kind: 'confirm'; email: string; password: string }
  | { kind: 'google' }
  | { kind: 'reset'; email: string }
  | { kind: 'choose-password'; user: AccountUser }
  | { kind: 'new-password'; user: AccountUser }
  | { kind: 'password-changed'; password: string };

export interface AuthDeps {
  vault: Vault;
  /** null: accounts are off (screenshots): the local password alone, as before accounts. */
  account: AccountService | null;
  /** Accounts are required but not configured: shown as an error instead of any screen. */
  unavailable?: string;
  startCallbackServer: (onResult: (r: CallbackResult) => void) => Promise<CallbackServer>;
  openExternal: (url: string) => Promise<void>;
  onChange?: (status: AuthStatus) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const info = (a: { email: string; provider: 'email' | 'google' }): AccountInfo => ({
  email: a.email,
  provider: a.provider,
});

export function createAuth(deps: AuthDeps) {
  const { vault } = deps;
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  let pending: Pending | null = null;
  let problem: string | null = null;
  let server: CallbackServer | null = null;
  let session: SessionState | null = null;
  let sessionTimer: unknown = null;

  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const next = queue.then(op, op);
    queue = next.catch(() => undefined);
    return next;
  };

  function account(): AccountService {
    if (!deps.account) throw new Error('Accounts are not set up in this build');
    return deps.account;
  }

  function status(): AuthStatus {
    if (deps.unavailable) return { state: 'error', message: deps.unavailable };
    const v = vault.status();
    if (!deps.account) {
      if (v.state === 'locked') return { state: 'locked', account: null };
      if (v.state === 'unlocked') return { ...v, account: null, session: null };
      return v;
    }
    if (v.state === 'error') return v;
    const linked = vault.account();
    const hasPlainData = v.state === 'setup' && v.hasPlainData;
    switch (pending?.kind) {
      case 'confirm':
        return { state: 'check-email', email: pending.email, purpose: 'signup', problem };
      case 'reset':
        return { state: 'check-email', email: pending.email, purpose: 'reset', problem };
      case 'google':
        return { state: 'browser' };
      case 'choose-password':
        return { state: 'choose-password', account: info(pending.user), hasPlainData };
      case 'new-password':
        return { state: 'new-password', account: info(pending.user), hasData: v.state !== 'setup' };
      case 'password-changed':
        if (linked) return { state: 'password-changed', account: info(linked) };
        break;
    }
    if (v.state === 'setup') {
      return { state: 'signin', purpose: 'new', account: null, hasPlainData, problem };
    }
    if (v.state === 'locked') {
      if (!linked) return { state: 'locked', account: null }; // unlock first, then link
      if (account().hasSession()) return { state: 'locked', account: info(linked) };
      return { state: 'signin', purpose: 'again', account: info(linked), hasPlainData, problem };
    }
    if (!linked) {
      return { state: 'signin', purpose: 'connect', account: null, hasPlainData: false, problem };
    }
    return { state: 'unlocked', recoveryKey: v.recoveryKey, account: info(linked), session };
  }

  function notify(): AuthStatus {
    const s = status();
    deps.onChange?.(s);
    return s;
  }

  // --- Browser flows (Google, email links) -------------------------------------------------

  async function stopServer(): Promise<void> {
    const s = server;
    server = null;
    await s?.close().catch((err: unknown) => console.error('[auth] callback server:', err));
  }

  /** Waits for a browser to come back with a code (the server stops after the first one). */
  async function startFlow(next: Pending): Promise<void> {
    await stopServer();
    server = await deps.startCallbackServer((r) => void onCallback(r));
    pending = next;
    problem = null;
  }

  function onCallback(r: CallbackResult): Promise<AuthStatus> {
    return serial(async () => {
      await stopServer();
      const flow = pending;
      if (!flow || !['confirm', 'google', 'reset'].includes(flow.kind)) return status();
      if ('error' in r) {
        // A Google cancel goes back to sign-in; an email link stays on "check your email".
        if (flow.kind === 'google') pending = null;
        problem = r.error;
        return notify();
      }
      try {
        const user = await account().exchangeCode(r.code);
        if (flow.kind === 'confirm') {
          pending = null;
          await finishEmail(user, flow.password);
        } else if (flow.kind === 'google') {
          pending = null;
          await finishGoogle(user);
        } else {
          pending = { kind: 'new-password', user };
        }
        problem = null;
      } catch (err) {
        if (flow.kind === 'google') pending = null;
        problem = err instanceof Error ? err.message : String(err);
        console.error('[auth] browser sign-in failed:', err);
      }
      return notify();
    });
  }

  // --- After a successful sign-in ----------------------------------------------------------

  function link(user: AccountUser, provider: 'email' | 'google'): Omit<LinkedAccount, 'linkedAt'> {
    return { userId: user.id, email: user.email, provider };
  }

  /** Data linked to another account must not open: sign that session out again. */
  async function assertSameAccount(user: AccountUser): Promise<void> {
    const linked = vault.account();
    if (linked && linked.userId !== user.id) {
      await account()
        .signOut()
        .catch(() => undefined);
      throw new Error(
        `Radar's data on this computer belongs to ${linked.email}. Sign in with that account.`,
      );
    }
  }

  async function finishEmail(user: AccountUser, password: string): Promise<void> {
    const v = vault.status();
    if (v.state === 'setup') {
      await vault.setup(password, link(user, 'email'));
    } else if (v.state === 'unlocked' && !vault.account()) {
      // Data from before accounts: from now on the account password encrypts it.
      await vault.changePassword(password);
      await vault.linkAccount(link(user, 'email'));
    } else if (v.state === 'locked') {
      await assertSameAccount(user);
      if (vault.account()?.provider === 'email') await unlockOrDetectChange(password);
      // A Google-linked computer still unlocks with its own Radar password (locked screen).
    }
    session = 'online';
    if (vault.isUnlocked()) keepSessionFresh(SESSION_REFRESH_MS);
  }

  async function finishGoogle(user: AccountUser): Promise<void> {
    const v = vault.status();
    if (v.state === 'setup') {
      pending = { kind: 'choose-password', user };
      return;
    }
    if (v.state === 'unlocked' && !vault.account()) {
      await vault.linkAccount(link(user, 'google')); // its local password stays
    } else {
      await assertSameAccount(user);
    }
    session = 'online';
    if (vault.isUnlocked()) keepSessionFresh(SESSION_REFRESH_MS);
  }

  /**
   * Unlocks with the account password; if it does not open the data but does sign in, the account
   * password was changed elsewhere: the recovery key re-encrypts the data with the new one.
   */
  async function unlockOrDetectChange(password: string): Promise<void> {
    try {
      await vault.unlock(password);
    } catch (err) {
      const linked = vault.account();
      if (!(err instanceof WrongSecretError) || linked?.provider !== 'email' || !deps.account) {
        throw err;
      }
      let user: AccountUser;
      try {
        user = await deps.account.signIn(linked.email, password);
      } catch {
        throw err; // offline, or simply a wrong password
      }
      if (user.id !== linked.userId) throw err;
      pending = { kind: 'password-changed', password };
    }
  }

  // --- Session upkeep while unlocked -------------------------------------------------------

  function stopSessionTimer(): void {
    if (sessionTimer !== null) clearT(sessionTimer);
    sessionTimer = null;
  }

  /** Renews the session after `delay`; offline retries sooner; an ended session waits for the user. */
  function keepSessionFresh(delay: number): void {
    stopSessionTimer();
    if (!deps.account) return;
    sessionTimer = setT(() => void refreshSession(), delay);
  }

  async function refreshSession(): Promise<void> {
    sessionTimer = null;
    if (!deps.account || !vault.isUnlocked()) return;
    try {
      await deps.account.refresh();
      session = 'online';
      keepSessionFresh(SESSION_REFRESH_MS);
    } catch (err) {
      const code = err instanceof AccountError ? err.code : 'other';
      if (code === 'session-expired') {
        session = 'expired';
      } else {
        session = 'offline';
        keepSessionFresh(SESSION_RETRY_MS);
      }
      console.warn(`[auth] session not renewed (${code})`);
    }
    notify();
  }

  function afterUnlock(): void {
    if (!deps.account || !vault.isUnlocked() || !vault.account()) return;
    session = session ?? 'offline';
    keepSessionFresh(0); // renew now, in the background
  }

  const requirePending = <K extends Pending['kind']>(kind: K) => {
    if (pending?.kind !== kind) throw new Error('This step is no longer open');
    return pending as Extract<Pending, { kind: K }>;
  };

  return {
    status,
    /** Re-sends the current status (the vault changed underneath). */
    notify,
    isUnlocked: () => vault.isUnlocked(),

    // Accounts off: local password only (screenshots).
    setup: (password: string) => serial(async () => (await vault.setup(password), notify())),

    createAccount: (email: string, password: string) =>
      serial(async () => {
        const s = status();
        if (s.state !== 'signin' || s.purpose === 'again') {
          throw new Error('Sign in with the account this computer belongs to');
        }
        const weak = passwordProblem(password);
        if (weak) throw new Error(weak);
        const r = await account().signUp(email, password);
        if (r.confirm || !r.user) await startFlow({ kind: 'confirm', email, password });
        else await finishEmail(r.user, password);
        problem = null;
        return notify();
      }),

    signIn: (email: string, password: string) =>
      serial(async () => {
        if (status().state !== 'signin') throw new Error('Radar is already signed in');
        try {
          const user = await account().signIn(email, password);
          await finishEmail(user, password);
        } catch (err) {
          if (err instanceof AccountError && err.code === 'email-not-confirmed') {
            await startFlow({ kind: 'confirm', email, password });
            return notify();
          }
          throw err;
        }
        problem = null;
        return notify();
      }),

    google: () =>
      serial(async () => {
        if (status().state !== 'signin') throw new Error('Radar is already signed in');
        if (!(await account().googleEnabled())) {
          throw new AccountError(
            'provider-disabled',
            'Google sign-in is not set up for this Radar yet',
          );
        }
        const url = await account().googleUrl();
        await startFlow({ kind: 'google' });
        await deps.openExternal(url);
        return notify();
      }),

    /** Leaves "check your email" or the browser wait, back to sign-in. */
    cancel: () =>
      serial(async () => {
        await stopServer();
        pending = null;
        problem = null;
        return notify();
      }),

    /** "I've confirmed my email": signs in with the password from the sign-up. */
    emailConfirmed: () =>
      serial(async () => {
        const flow = requirePending('confirm');
        const user = await account().signIn(flow.email, flow.password);
        await stopServer();
        pending = null;
        await finishEmail(user, flow.password);
        problem = null;
        return notify();
      }),

    resendEmail: () =>
      serial(async () => {
        const flow = requirePending('confirm');
        await account().resendConfirmation(flow.email);
        problem = null;
        return notify();
      }),

    requestReset: (email: string) =>
      serial(async () => {
        await account().requestPasswordReset(email);
        await startFlow({ kind: 'reset', email });
        return notify();
      }),

    /** After a reset link: the new account password, and the recovery key for data kept here. */
    setNewPassword: (password: string, recoveryKey: string) =>
      serial(async () => {
        const { user } = requirePending('new-password');
        const weak = passwordProblem(password);
        if (weak) throw new Error(weak);
        const v = vault.status();
        if (v.state === 'locked') {
          await assertSameAccount(user);
          vault.checkRecoveryKey(recoveryKey); // before the account changes, so both stay in step
          await account().updatePassword(password);
          await vault.recover(recoveryKey, password);
        } else {
          await account().updatePassword(password);
          if (v.state === 'setup') await vault.setup(password, link(user, 'email'));
        }
        pending = null;
        session = 'online';
        afterUnlock();
        return notify();
      }),

    /** First Google sign-in here: the password that encrypts the data on this computer. */
    choosePassword: (password: string) =>
      serial(async () => {
        const { user } = requirePending('choose-password');
        await vault.setup(password, link(user, 'google'));
        pending = null;
        session = 'online';
        afterUnlock();
        return notify();
      }),

    unlock: (password: string) =>
      serial(async () => {
        await unlockOrDetectChange(password);
        afterUnlock();
        return notify();
      }),

    /** The account password changed elsewhere: the recovery key re-encrypts the data here. */
    finishPasswordChange: (recoveryKey: string) =>
      serial(async () => {
        const flow = requirePending('password-changed');
        await vault.recover(recoveryKey, flow.password);
        pending = null;
        afterUnlock();
        return notify();
      }),

    /** Forgot the Radar password (Google users, or no account): recovery key + new password. */
    recover: (recoveryKey: string, newPassword: string) =>
      serial(async () => {
        if (vault.account()?.provider === 'email') {
          throw new Error('Reset your password by email: your account password unlocks Radar');
        }
        await vault.recover(recoveryKey, newPassword);
        afterUnlock();
        return notify();
      }),

    confirmRecoveryKey: () => serial(async () => (await vault.confirmRecoveryKey(), notify())),

    lock: () =>
      serial(async () => {
        stopSessionTimer();
        await vault.lock();
        return notify();
      }),

    /** Forgets the session here and locks; signing in again (same account) opens the data. */
    signOut: () =>
      serial(async () => {
        stopSessionTimer();
        try {
          await account().signOut();
        } catch (err) {
          console.warn('[auth] sign-out reached only this computer:', err);
        }
        session = null;
        await vault.lock();
        return notify();
      }),

    /** Stops timers and the callback server (app quit). */
    dispose: async () => {
      stopSessionTimer();
      await stopServer();
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
