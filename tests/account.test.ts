import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readCallback,
  startCallbackServer,
  type CallbackResult,
} from '../src/main/account/callback-server';
import { AccountError, toAccountError } from '../src/main/account/service';
import { createSessionStore, type Codec } from '../src/main/account/session-store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'radar-account-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Stands in for safeStorage: reversible, and visibly not plain text. */
const codec = (available = true): Codec => ({
  available: () => available,
  encrypt: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decrypt: (b) => {
    const t = b.toString();
    if (!t.startsWith('enc:')) throw new Error('not ours');
    return Buffer.from(t.slice(4), 'base64').toString();
  },
});

describe('session store', () => {
  it('keeps tokens only encrypted on disk and reads them back', () => {
    const file = join(dir, 'session.bin');
    const a = createSessionStore(file, codec());
    a.setItem('radar-auth', '{"access_token":"secret-token"}');
    expect(readFileSync(file, 'utf8')).not.toContain('secret-token');
    const b = createSessionStore(file, codec());
    expect(b.getItem('radar-auth')).toBe('{"access_token":"secret-token"}');
    expect(b.has('radar-auth')).toBe(true);
    b.removeItem('radar-auth');
    expect(existsSync(file)).toBe(false); // nothing left to keep
  });

  it('an unreadable file means signed out, never a crash', () => {
    const file = join(dir, 'session.bin');
    writeFileSync(file, 'from another Windows user');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = createSessionStore(file, codec());
    expect(s.has('radar-auth')).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('without secure storage the session stays in memory only', () => {
    const file = join(dir, 'session.bin');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = createSessionStore(file, codec(false));
    s.setItem('radar-auth', 'x');
    expect(s.getItem('radar-auth')).toBe('x');
    expect(existsSync(file)).toBe(false);
    warn.mockRestore();
  });
});

describe('callback server', () => {
  it('reads codes and errors from the callback URL only', () => {
    expect(readCallback('/auth/callback?code=abc')).toEqual({ code: 'abc' });
    expect(
      readCallback('/auth/callback?error=access_denied&error_description=User+said+no'),
    ).toEqual({ error: 'User said no' });
    expect(readCallback('/auth/callback')).toEqual({
      error: 'The sign-in link did not include a code',
    });
    expect(readCallback('/elsewhere?code=abc')).toBeNull();
  });

  it('hands the first code to main, answers the browser, and refuses a busy port', async () => {
    const results: CallbackResult[] = [];
    const port = 47_400 + Math.floor(Math.random() * 400);
    const server = await startCallbackServer((r) => results.push(r), port);
    try {
      const page = await fetch(`http://127.0.0.1:${port}/auth/callback?code=c-1`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('You can go back to Radar');
      await fetch(`http://127.0.0.1:${port}/auth/callback?code=c-2`); // only the first counts
      expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
      const bad = await fetch(
        `http://127.0.0.1:${port}/auth/callback?error_description=<script>x</script>`,
      );
      expect(await bad.text()).not.toContain('<script>');
      expect(results).toEqual([{ code: 'c-1' }]);
      await expect(startCallbackServer(() => {}, port)).rejects.toThrow(/in use/);
    } finally {
      await server.close();
    }
  });
});

describe('account errors', () => {
  const api = (message: string, status: number, code: string) =>
    new AuthApiError(message, status, code);

  it('maps Supabase errors to what the screens explain', () => {
    expect(toAccountError(api('Invalid login credentials', 400, 'invalid_credentials')).code).toBe(
      'invalid-credentials',
    );
    expect(toAccountError(api('Email not confirmed', 400, 'email_not_confirmed')).code).toBe(
      'email-not-confirmed',
    );
    expect(toAccountError(api('User already registered', 422, 'user_already_exists')).code).toBe(
      'user-exists',
    );
    expect(toAccountError(api('rate limit', 429, 'over_email_send_rate_limit')).code).toBe(
      'rate-limited',
    );
    expect(toAccountError(api('Invalid Refresh Token', 400, 'refresh_token_not_found')).code).toBe(
      'session-expired',
    );
    expect(toAccountError(new AuthRetryableFetchError('fetch failed', 0)).code).toBe('offline');
    expect(toAccountError(new TypeError('fetch failed')).code).toBe('offline');
    const other = toAccountError(api('Something odd', 400, 'unexpected'));
    expect(other).toBeInstanceOf(AccountError);
    expect(other.message).toBe('Something odd');
  });
});
