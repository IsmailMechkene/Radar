// The online account (Supabase Auth) as main uses it. The interface is what the sign-in flows in
// auth.ts depend on (tests fake it); createSupabaseAccount implements it with supabase-js, PKCE
// and a session store that never leaves main. No Electron imports.
import { createClient, isAuthError, type User } from '@supabase/supabase-js';
import type { SessionStore } from './session-store';

export interface AccountUser {
  id: string;
  email: string;
  /** How this session signed in. */
  provider: 'email' | 'google';
}

export type AccountErrorCode =
  | 'offline'
  | 'invalid-credentials'
  | 'email-not-confirmed'
  | 'user-exists'
  | 'weak-password'
  | 'rate-limited'
  | 'session-expired'
  | 'provider-disabled'
  | 'other';

/** A failure the sign-in screens can explain. */
export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

export interface AccountService {
  /** A signed-in session is stored (it may have expired; refresh() asks the server). */
  hasSession(): boolean;
  signUp(email: string, password: string): Promise<{ user: AccountUser | null; confirm: boolean }>;
  signIn(email: string, password: string): Promise<AccountUser>;
  resendConfirmation(email: string): Promise<void>;
  /** Whether Google sign-in is turned on for this project. */
  googleEnabled(): Promise<boolean>;
  /** The Google sign-in page to open in the browser; the result comes back as a code. */
  googleUrl(): Promise<string>;
  /** Finishes any browser flow (Google, confirmation link, reset link) with its PKCE code. */
  exchangeCode(code: string): Promise<AccountUser>;
  requestPasswordReset(email: string): Promise<void>;
  /** Needs a session (after a reset link). */
  updatePassword(password: string): Promise<void>;
  /** Renews the session with the server; throws 'offline' or 'session-expired'. */
  refresh(): Promise<AccountUser>;
  /** Forgets the session here (and revokes it on the server when online). */
  signOut(): Promise<void>;
}

export const SESSION_KEY = 'radar-auth';

const MESSAGES: Record<AccountErrorCode, string> = {
  offline: 'Radar could not reach the account server. Check your connection and try again.',
  'invalid-credentials': 'Wrong email or password',
  'email-not-confirmed': 'Confirm your email first: open the link we sent you',
  'user-exists': 'An account with this email already exists. Sign in instead.',
  'weak-password': 'Choose a stronger password',
  'rate-limited': 'Too many attempts. Wait a few minutes and try again.',
  'session-expired': 'Your session ended. Sign in again.',
  'provider-disabled': 'Google sign-in is not set up for this Radar yet',
  other: 'The account server refused the request',
};

/** Maps supabase-js and network errors onto the codes the screens explain. */
export function toAccountError(err: unknown): AccountError {
  if (err instanceof AccountError) return err;
  const fail = (code: AccountErrorCode, detail?: string) =>
    new AccountError(code, code === 'other' && detail ? detail : MESSAGES[code]);
  if (isAuthError(err)) {
    const code = (err as { code?: string }).code ?? '';
    if (err.name === 'AuthRetryableFetchError' || err.status === 0) return fail('offline');
    if (code === 'invalid_credentials') return fail('invalid-credentials');
    if (code === 'email_not_confirmed') return fail('email-not-confirmed');
    if (code === 'user_already_exists' || code === 'email_exists') return fail('user-exists');
    if (code === 'weak_password') return fail('weak-password');
    if (code.startsWith('over_') || err.status === 429) return fail('rate-limited');
    if (
      code.startsWith('refresh_token') ||
      code === 'session_not_found' ||
      code === 'session_expired' ||
      err.name === 'AuthSessionMissingError'
    ) {
      return fail('session-expired');
    }
    if (
      code === 'provider_disabled' ||
      (code === 'validation_failed' && /provider/i.test(err.message))
    )
      return fail('provider-disabled');
    return fail('other', err.message);
  }
  if (err instanceof TypeError && /fetch/i.test(err.message)) return fail('offline');
  return fail('other', err instanceof Error ? err.message : String(err));
}

function toUser(u: User | null | undefined): AccountUser {
  if (!u?.email) throw new AccountError('other', 'The account server returned no user');
  const provider = u.app_metadata?.['provider'] === 'google' ? 'google' : 'email';
  return { id: u.id, email: u.email, provider };
}

export interface SupabaseConfig {
  url: string;
  key: string;
  storage: SessionStore;
  /** Where browser flows return (the loopback callback server). */
  redirectTo: string;
  fetch?: typeof fetch;
}

export type RadarSupabase = ReturnType<typeof createSupabaseClient>;

/** One client for the account and sync: data requests carry the signed-in session. */
export function createSupabaseClient(config: SupabaseConfig) {
  return createClient(config.url, config.key, {
    auth: {
      flowType: 'pkce',
      storage: config.storage,
      storageKey: SESSION_KEY,
      persistSession: true,
      // Main refreshes explicitly (auth.ts): it needs to know when Radar is offline.
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(config.fetch ? { global: { fetch: config.fetch } } : {}),
  });
}

export function createSupabaseAccount(
  config: SupabaseConfig,
  supabase: RadarSupabase = createSupabaseClient(config),
): AccountService {
  const auth = supabase.auth;

  async function call<R extends { data: unknown; error: unknown }>(
    op: () => Promise<R>,
  ): Promise<R['data']> {
    let r: R;
    try {
      r = await op();
    } catch (err) {
      throw toAccountError(err);
    }
    if (r.error) throw toAccountError(r.error);
    return r.data;
  }

  return {
    hasSession: () => config.storage.has(SESSION_KEY),

    async signUp(email, password) {
      const data = await call(() =>
        auth.signUp({ email, password, options: { emailRedirectTo: config.redirectTo } }),
      );
      // With email confirmation on, an existing address comes back as a user with no identities.
      if (data.user && data.user.identities?.length === 0) {
        throw new AccountError('user-exists', MESSAGES['user-exists']);
      }
      return { user: data.session ? toUser(data.user) : null, confirm: !data.session };
    },

    async signIn(email, password) {
      return toUser((await call(() => auth.signInWithPassword({ email, password }))).user);
    },

    async resendConfirmation(email) {
      await call(() =>
        auth.resend({ type: 'signup', email, options: { emailRedirectTo: config.redirectTo } }),
      );
    },

    async googleEnabled() {
      // Public settings endpoint: which providers are on (no session needed).
      try {
        const res = await (config.fetch ?? fetch)(`${config.url}/auth/v1/settings`, {
          headers: { apikey: config.key },
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { external?: { google?: boolean } };
        return body.external?.google === true;
      } catch (err) {
        throw toAccountError(err);
      }
    },

    async googleUrl() {
      const data = await call(() =>
        auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: config.redirectTo,
            skipBrowserRedirect: true,
            queryParams: { prompt: 'select_account' },
          },
        }),
      );
      if (!data.url) throw new AccountError('other', 'No Google sign-in address was returned');
      return data.url;
    },

    async exchangeCode(code) {
      return toUser((await call(() => auth.exchangeCodeForSession(code))).user);
    },

    async requestPasswordReset(email) {
      await call(() => auth.resetPasswordForEmail(email, { redirectTo: config.redirectTo }));
    },

    async updatePassword(password) {
      await call(() => auth.updateUser({ password }));
    },

    async refresh() {
      const data = await call(() => auth.refreshSession());
      if (!data.session) throw new AccountError('session-expired', MESSAGES['session-expired']);
      return toUser(data.user);
    },

    async signOut() {
      try {
        // 'local': this computer only; other devices stay signed in.
        await auth.signOut({ scope: 'local' });
      } finally {
        config.storage.removeItem(SESSION_KEY);
      }
    },
  };
}
