import { describe, expect, it } from 'vitest';
import { LOGIN_TIPS, lockView, nextTip } from '../src/renderer/src/lib/lock';
import { newPasswordProblem, passwordProblem } from '../src/shared/password';

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

  it('checks a new password typed twice', () => {
    expect(newPasswordProblem('short', 'short')).toMatch(/at least 8/);
    expect(newPasswordProblem('long enough', 'long enougH')).toBe('The passwords do not match');
    expect(newPasswordProblem('long enough', 'long enough')).toBeNull();
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
