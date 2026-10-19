import { describe, expect, it } from 'vitest';
import { LOGIN_TIPS, lockView, nextTip } from '../src/renderer/src/lib/lock';
import {
  newPasswordProblem,
  passwordChecks,
  passwordProblem,
  passwordStrength,
} from '../src/shared/password';

describe('lock screen', () => {
  it('shows the app only when unlocked and the recovery key is saved', () => {
    expect(lockView(null)).toBe('loading');
    expect(lockView({ state: 'setup', hasPlainData: true })).toBe('setup');
    expect(lockView({ state: 'locked', account: null })).toBe('locked');
    expect(
      lockView({
        state: 'signin',
        purpose: 'new',
        account: null,
        hasPlainData: false,
        problem: null,
      }),
    ).toBe('signin');
    expect(lockView({ state: 'browser' })).toBe('browser');
    expect(lockView({ state: 'error', message: 'keys.json is damaged' })).toBe('error');
    const unlocked = { state: 'unlocked', account: null, session: null } as const;
    expect(lockView({ ...unlocked, recoveryKey: 'ABCD-EFGH' })).toBe('recovery-key');
    expect(lockView({ ...unlocked, recoveryKey: null })).toBe('app');
  });

  it('checks a new password against the three requirements', () => {
    expect(newPasswordProblem('short')).toMatch(/at least 8/);
    expect(newPasswordProblem('long enough')).toBe('Meet all three requirements below');
    expect(newPasswordProblem('Long enough 1')).toBeNull();
    expect(newPasswordProblem('Éléphant rose!')).toBeNull(); // accented letters count as cases
    expect(passwordChecks('abcdefghij').map((c) => c.met)).toEqual([true, false, false]);
    expect(passwordChecks('Abc-1').map((c) => c.met)).toEqual([false, true, true]);
    // Strength: one step per requirement met, Strong when all are met at 14+ characters.
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(0);
    expect(passwordStrength('abcdefghij')).toBe(1);
    expect(passwordStrength('Abcdefghij')).toBe(2);
    expect(passwordStrength('Abcdefghij1')).toBe(3);
    expect(passwordStrength('Abcdefghijklm1')).toBe(4);
    // Passwords set before these rules still unlock: only the old minimum applies there.
    expect(passwordProblem('oldpass1')).toBeNull();
    // 72 bytes is the limit, not 72 characters.
    expect(passwordProblem('a'.repeat(72))).toBeNull();
    expect(passwordProblem('ü'.repeat(37))).toMatch(/at most 72 bytes/);
  });

  it('cycles through the login tips', () => {
    expect(LOGIN_TIPS.length).toBeGreaterThan(3);
    expect(nextTip(0)).toBe(1);
    expect(nextTip(LOGIN_TIPS.length - 1)).toBe(0);
    expect(nextTip(3, 0)).toBe(0);
  });
});
