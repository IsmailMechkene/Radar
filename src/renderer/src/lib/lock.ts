import type { AuthStatus } from '../../../shared/ipc';

/** Which screen the lock state calls for; 'app' renders the app itself. */
export type LockView = 'loading' | 'setup' | 'recovery-key' | 'locked' | 'error' | 'app';

export function lockView(status: AuthStatus | null): LockView {
  if (!status) return 'loading';
  if (status.state === 'unlocked') return status.recoveryKey ? 'recovery-key' : 'app';
  return status.state;
}
