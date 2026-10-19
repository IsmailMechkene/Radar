import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../src/core/db/migrate';
import { isPlainDatabase, openDatabase, resolveDbPath } from '../src/core/db/open';
import { readKeyFile, type ScryptParams } from '../src/core/vault/keys';
import { prepareEncryptedDatabase } from '../src/core/vault/encrypt';
import type { CallbackResult } from '../src/main/account/callback-server';
import { AccountError, type AccountService, type AccountUser } from '../src/main/account/service';
import { createAuth, SESSION_REFRESH_MS, SESSION_RETRY_MS } from '../src/main/auth';
import { createVault } from '../src/main/vault';

const FAST: ScryptParams = { N: 2 ** 10, r: 8, p: 1 };
const NOW = new Date('2026-10-19T09:00:00.000Z');
const ALICE = 'alice@example.com';
const PW = 'alice password 1';

/** An in-memory Supabase Auth: users, sessions, one-time codes, and switches for failures. */
function fakeAccount() {
  const users = new Map<
    string,
    { id: string; password: string | null; provider: 'email' | 'google'; confirmed: boolean }
  >();
  const codes = new Map<string, string>(); // code -> email
  let signedIn: string | null = null;
  let n = 0;
  const calls: string[] = [];
  const state = {
    confirmRequired: true,
    googleEnabled: true,
    offline: false,
    refresh: 'ok' as 'ok' | 'offline' | 'expired',
  };
  const user = (email: string): AccountUser => {
    const u = users.get(email)!;
    return { id: u.id, email, provider: u.provider };
  };
  const online = () => {
    if (state.offline) throw new AccountError('offline', 'offline');
  };
  const service: AccountService = {
    hasSession: () => signedIn !== null,
    async signUp(email, password) {
      online();
      calls.push(`signUp ${email}`);
      if (users.has(email)) throw new AccountError('user-exists', 'exists');
      users.set(email, {
        id: `00000000-0000-4000-8000-00000000000${++n}`,
        password,
        provider: 'email',
        confirmed: !state.confirmRequired,
      });
      if (state.confirmRequired) return { user: null, confirm: true };
      signedIn = email;
      return { user: user(email), confirm: false };
    },
    async signIn(email, password) {
      online();
      calls.push(`signIn ${email}`);
      const u = users.get(email);
      if (!u || u.password !== password) {
        throw new AccountError('invalid-credentials', 'Wrong email or password');
      }
      if (!u.confirmed) throw new AccountError('email-not-confirmed', 'Confirm your email first');
      signedIn = email;
      return user(email);
    },
    async resendConfirmation(email) {
      calls.push(`resend ${email}`);
    },
    googleEnabled: async () => state.googleEnabled,
    googleUrl: async () => 'https://accounts.example/google',
    async exchangeCode(code) {
      online();
      const email = codes.get(code);
      if (!email) throw new AccountError('other', 'invalid code');
      codes.delete(code);
      const u = users.get(email)!;
      u.confirmed = true;
      signedIn = email;
      return user(email);
    },
    async requestPasswordReset(email) {
      calls.push(`reset ${email}`);
    },
    async updatePassword(password) {
      if (!signedIn) throw new AccountError('session-expired', 'no session');
      calls.push('updatePassword');
      users.get(signedIn)!.password = password;
    },
    async refresh() {
      if (state.refresh === 'offline') throw new AccountError('offline', 'offline');
      if (state.refresh === 'expired' || !signedIn) {
        signedIn = null;
        throw new AccountError('session-expired', 'ended');
      }
      return user(signedIn);
    },
    async signOut() {
      calls.push('signOut');
      signedIn = null;
    },
  };
  return {
    service,
    calls,
    state,
    users,
    /** A browser coming back with a code for this email (link clicked, Google done). */
    codeFor(email: string, provider: 'email' | 'google' = 'email') {
      if (!users.has(email)) {
        users.set(email, {
          id: `00000000-0000-4000-8000-00000000009${++n}`,
          password: null,
          provider,
          confirmed: true,
        });
      }
      const code = `code-${++n}`;
      codes.set(code, email);
      return code;
    },
    signedInAs: () => signedIn,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'radar-auth-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function setup(opts: { accounts?: boolean; unavailable?: string } = {}) {
  const account = fakeAccount();
  let callback: ((r: CallbackResult) => void) | null = null;
  let serverOpen = false;
  const opened: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const vault = createVault({
    dataDir: dir,
    now: () => NOW,
    scrypt: FAST,
    open: async (key) => {
      await prepareEncryptedDatabase(dir, key);
      const db = openDatabase(resolveDbPath(dir), key);
      migrate(db);
      db.close();
    },
    close: async () => {},
    onChange: () => auth.notify(),
  });
  const auth = createAuth({
    vault,
    account: opts.accounts === false ? null : account.service,
    unavailable: opts.unavailable,
    startCallbackServer: async (onResult) => {
      callback = onResult;
      serverOpen = true;
      return {
        close: async () => {
          serverOpen = false;
        },
      };
    },
    openExternal: async (url) => void opened.push(url),
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => {},
  });
  return {
    auth,
    vault,
    account,
    opened,
    timers,
    serverOpen: () => serverOpen,
    /** The browser comes back (the auth flow runs serially, so await the status after). */
    async browserReturns(r: CallbackResult) {
      expect(callback).not.toBeNull();
      callback!(r);
      // The flow runs in the auth queue: wait until it moved past the wait (or reported why not).
      await vi.waitFor(() => {
        const s = auth.status();
        const waiting = s.state === 'browser' || (s.state === 'check-email' && !s.problem);
        expect(waiting).toBe(false);
      });
    },
    /** Runs the session-refresh timers scheduled so far. */
    async runTimers() {
      const due = timers.splice(0);
      for (const t of due) t.fn();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

/** Creates Alice's account through the confirmation link and saves the recovery key. */
async function aliceSetUp(t: ReturnType<typeof setup>): Promise<string> {
  await t.auth.createAccount(ALICE, PW);
  const code = t.account.codeFor(ALICE);
  t.account.calls.length = 0;
  await t.browserReturns({ code });
  const s = t.auth.status();
  if (s.state !== 'unlocked' || !s.recoveryKey) throw new Error(`not set up: ${JSON.stringify(s)}`);
  await t.auth.confirmRecoveryKey();
  return s.recoveryKey;
}

describe('auth: email accounts', () => {
  it('first run: create account, confirm by email, the account password encrypts the data', async () => {
    const t = setup();
    expect(t.auth.status()).toMatchObject({ state: 'signin', purpose: 'new' });
    await expect(t.auth.createAccount(ALICE, 'short')).rejects.toThrow(/at least 8/);

    expect(await t.auth.createAccount(ALICE, PW)).toEqual({
      state: 'check-email',
      email: ALICE,
      purpose: 'signup',
      problem: null,
    });
    expect(t.serverOpen()).toBe(true);
    await t.browserReturns({ code: t.account.codeFor(ALICE) });

    const s = t.auth.status();
    expect(s).toMatchObject({
      state: 'unlocked',
      account: { email: ALICE, provider: 'email' },
      session: 'online',
    });
    expect(s.state === 'unlocked' && s.recoveryKey).toBeTruthy();
    expect(readKeyFile(dir)?.account).toMatchObject({ email: ALICE, provider: 'email' });
    expect(isPlainDatabase(resolveDbPath(dir))).toBe(false);

    await t.auth.confirmRecoveryKey();
    await t.auth.lock();
    expect(t.auth.status()).toEqual({
      state: 'locked',
      account: { email: ALICE, provider: 'email' },
    });
    // Offline: the account password still unlocks the data here.
    t.account.state.offline = true;
    t.account.state.refresh = 'offline';
    expect(await t.auth.unlock(PW)).toMatchObject({ state: 'unlocked', recoveryKey: null });
  });

  it('"I have confirmed" signs in with the sign-up password; an unconfirmed address waits', async () => {
    const t = setup();
    await t.auth.createAccount(ALICE, PW);
    await expect(t.auth.emailConfirmed()).rejects.toThrow(/Confirm your email/);
    await t.auth.resendEmail();
    expect(t.account.calls).toContain(`resend ${ALICE}`);
    t.account.users.get(ALICE)!.confirmed = true; // clicked the link on the phone
    expect(await t.auth.emailConfirmed()).toMatchObject({ state: 'unlocked' });
    expect(t.serverOpen()).toBe(false);
  });

  it('signing in on a new computer sets up its data with the same password', async () => {
    const t = setup();
    t.account.state.confirmRequired = false;
    await t.account.service.signUp(ALICE, PW); // the account already exists
    await t.account.service.signOut();
    await expect(t.auth.signIn(ALICE, 'wrong password!')).rejects.toThrow(
      /Wrong email or password/,
    );
    expect(await t.auth.signIn(ALICE, PW)).toMatchObject({
      state: 'unlocked',
      account: { email: ALICE },
    });
  });

  it('wrong password at unlock: refused, and nothing changes', async () => {
    const t = setup();
    await aliceSetUp(t);
    await t.auth.lock();
    await expect(t.auth.unlock('not the password')).rejects.toThrow(/Wrong password/);
    expect(t.auth.status().state).toBe('locked');
  });

  it('password changed on another computer: the recovery key re-encrypts the data here', async () => {
    const t = setup();
    const recoveryKey = await aliceSetUp(t);
    await t.auth.lock();
    t.account.users.get(ALICE)!.password = 'changed elsewhere 2';

    expect(await t.auth.unlock('changed elsewhere 2')).toEqual({
      state: 'password-changed',
      account: { email: ALICE, provider: 'email' },
    });
    await expect(t.auth.finishPasswordChange('AAAA-BBBB')).rejects.toThrow(/Wrong recovery key/);
    expect(await t.auth.finishPasswordChange(recoveryKey)).toMatchObject({ state: 'unlocked' });
    await t.auth.lock();
    await expect(t.auth.unlock(PW)).rejects.toThrow(/Wrong password/);
    expect((await t.auth.unlock('changed elsewhere 2')).state).toBe('unlocked');
  });

  it('forgot password: reset link, then new password + recovery key; the server is updated last', async () => {
    const t = setup();
    const recoveryKey = await aliceSetUp(t);
    await t.auth.signOut();
    expect(t.auth.status()).toMatchObject({
      state: 'signin',
      purpose: 'again',
      account: { email: ALICE },
    });

    expect(await t.auth.requestReset(ALICE)).toMatchObject({
      state: 'check-email',
      purpose: 'reset',
    });
    await t.browserReturns({ code: t.account.codeFor(ALICE) });
    expect(t.auth.status()).toEqual({
      state: 'new-password',
      account: { email: ALICE, provider: 'email' },
      hasData: true,
    });

    t.account.calls.length = 0;
    await expect(t.auth.setNewPassword('brand new pass 3', 'WRONG-KEY')).rejects.toThrow(
      /Wrong recovery key/,
    );
    expect(t.account.calls).not.toContain('updatePassword'); // account and data stay in step
    expect(await t.auth.setNewPassword('brand new pass 3', recoveryKey)).toMatchObject({
      state: 'unlocked',
    });
    expect(t.account.users.get(ALICE)!.password).toBe('brand new pass 3');
    await t.auth.lock();
    expect((await t.auth.unlock('brand new pass 3')).state).toBe('unlocked');
  });

  it("another account cannot open this computer's data", async () => {
    const t = setup();
    await aliceSetUp(t);
    await t.auth.signOut();
    t.account.state.confirmRequired = false;
    await t.account.service.signUp('bob@example.com', 'bob password 1');
    await t.account.service.signOut();
    await expect(t.auth.signIn('bob@example.com', 'bob password 1')).rejects.toThrow(
      /belongs to alice@example.com/,
    );
    expect(t.account.signedInAs()).toBeNull(); // Bob's session was dropped again
    expect(t.auth.status()).toMatchObject({ state: 'signin', purpose: 'again' });
  });

  it('an email account resets by email, not with the recovery key alone', async () => {
    const t = setup();
    const recoveryKey = await aliceSetUp(t);
    await t.auth.lock();
    await expect(t.auth.recover(recoveryKey, 'another pass 4')).rejects.toThrow(/by email/);
  });
});

describe('auth: Google', () => {
  it('first sign-in: browser, then a Radar password for this computer', async () => {
    const t = setup();
    expect(await t.auth.google()).toEqual({ state: 'browser' });
    expect(t.opened).toEqual(['https://accounts.example/google']);
    await t.browserReturns({ code: t.account.codeFor('gina@example.com', 'google') });
    expect(t.auth.status()).toMatchObject({
      state: 'choose-password',
      account: { email: 'gina@example.com', provider: 'google' },
    });
    expect(await t.auth.choosePassword('gina radar pw 1')).toMatchObject({
      state: 'unlocked',
      account: { provider: 'google' },
    });
    await t.auth.confirmRecoveryKey();
    await t.auth.lock();
    expect(t.auth.status()).toEqual({
      state: 'locked',
      account: { email: 'gina@example.com', provider: 'google' },
    });
    expect((await t.auth.unlock('gina radar pw 1')).state).toBe('unlocked');
  });

  it('a Google user who forgot the Radar password uses the recovery key', async () => {
    const t = setup();
    await t.auth.google();
    await t.browserReturns({ code: t.account.codeFor('gina@example.com', 'google') });
    const s = await t.auth.choosePassword('gina radar pw 1');
    const recoveryKey = s.state === 'unlocked' ? s.recoveryKey! : '';
    await t.auth.lock();
    expect((await t.auth.recover(recoveryKey, 'gina new radar 2')).state).toBe('unlocked');
  });

  it('cancelled or failed in the browser: back to sign-in with the reason', async () => {
    const t = setup();
    await t.auth.google();
    await t.browserReturns({ error: 'The user denied the request' });
    expect(t.auth.status()).toMatchObject({
      state: 'signin',
      problem: 'The user denied the request',
    });
  });

  it('Google turned off for the project: says so, opens nothing', async () => {
    const t = setup();
    t.account.state.googleEnabled = false;
    await expect(t.auth.google()).rejects.toThrow(/not set up/);
    expect(t.opened).toEqual([]);
    expect(t.auth.status().state).toBe('signin');
  });
});

describe('auth: data from before accounts', () => {
  it('unlocks with the old password, then links an account whose password takes over', async () => {
    const t = setup();
    // Phase 1: a local password only.
    await t.vault.setup('old local password');
    await t.vault.confirmRecoveryKey();
    await t.vault.lock();
    expect(t.auth.status()).toEqual({ state: 'locked', account: null });

    await t.auth.unlock('old local password');
    expect(t.auth.status()).toMatchObject({ state: 'signin', purpose: 'connect' });
    t.account.state.confirmRequired = false;
    expect(await t.auth.createAccount(ALICE, PW)).toMatchObject({
      state: 'unlocked',
      account: { email: ALICE },
    });
    await t.auth.lock();
    await expect(t.auth.unlock('old local password')).rejects.toThrow(/Wrong password/);
    expect((await t.auth.unlock(PW)).state).toBe('unlocked');
  });
});

describe('auth: session upkeep', () => {
  it('renews in the background: offline retries, back online, then an ended session waits', async () => {
    const t = setup();
    await aliceSetUp(t);
    await t.auth.lock();
    t.timers.length = 0;
    t.account.state.refresh = 'offline';
    await t.auth.unlock(PW);
    expect(t.timers.map((x) => x.ms)).toEqual([0]); // renew right after unlocking

    await t.runTimers();
    expect(t.auth.status()).toMatchObject({ state: 'unlocked', session: 'offline' });
    expect(t.timers.map((x) => x.ms)).toEqual([SESSION_RETRY_MS]);

    t.account.state.refresh = 'ok';
    await t.runTimers();
    expect(t.auth.status()).toMatchObject({ session: 'online' });
    expect(t.timers.map((x) => x.ms)).toEqual([SESSION_REFRESH_MS]);

    t.account.state.refresh = 'expired';
    await t.runTimers();
    expect(t.auth.status()).toMatchObject({ session: 'expired' });
    expect(t.timers).toEqual([]); // the user signs in again from Settings
  });

  it('sign out forgets the session and locks; signing in again (same account) opens the data', async () => {
    const t = setup();
    await aliceSetUp(t);
    expect(await t.auth.signOut()).toMatchObject({ state: 'signin', purpose: 'again' });
    expect(t.vault.isUnlocked()).toBe(false);
    expect((await t.auth.signIn(ALICE, PW)).state).toBe('unlocked');
  });
});

describe('auth: without accounts', () => {
  it('screenshots: a local password only, as before accounts', async () => {
    const t = setup({ accounts: false });
    expect(t.auth.status()).toEqual({ state: 'setup', hasPlainData: false });
    const s = await t.auth.setup('local only pass');
    expect(s).toMatchObject({ state: 'unlocked', account: null, session: null });
  });

  it('accounts required but not configured: an error explains what to add', () => {
    const t = setup({ unavailable: 'Radar needs its account settings: copy .env.example to .env' });
    expect(t.auth.status()).toEqual({
      state: 'error',
      message: 'Radar needs its account settings: copy .env.example to .env',
    });
  });
});
