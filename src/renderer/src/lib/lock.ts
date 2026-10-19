import type { AuthStatus, SessionState } from '../../../shared/ipc';

/** Which screen the lock state calls for; 'app' renders the app itself. */
export type LockView =
  'loading' | Exclude<AuthStatus['state'], 'unlocked'> | 'recovery-key' | 'app';

export function lockView(status: AuthStatus | null): LockView {
  if (!status) return 'loading';
  if (status.state === 'unlocked') return status.recoveryKey ? 'recovery-key' : 'app';
  return status.state;
}

/** How Settings describes the account session. */
export function sessionLabel(session: SessionState | null): {
  text: string;
  tone: 'green' | 'amber' | 'red' | 'gray';
} {
  if (session === 'online') return { text: 'Connected', tone: 'green' };
  if (session === 'offline') return { text: 'Offline, reconnects by itself', tone: 'amber' };
  if (session === 'expired') return { text: 'Session ended: sign in again', tone: 'red' };
  return { text: 'Not connected', tone: 'gray' };
}

/** "Did you know?" on the login window: only things Radar really does. */
export const LOGIN_TIPS: readonly string[] = [
  'Radar reads deadlines in English and French, like “31 mars 2027”, and keeps the sentence it found them in.',
  'Dates copied from last year’s cycle show a dashed “Expected” badge until the live page confirms them.',
  'Every point in a score traces back to one rule you can change on the Rules page.',
  'Press J and K to move through results, S to star one and X to dismiss it.',
  'Marking a Pipeline entry as Sent plans follow-ups 7 and 14 days later.',
  'Your pipeline, rules and drafts sync between your computers, encrypted before they leave this one.',
  'Your data and its daily backups are encrypted on this computer with your password.',
];

/** Tips rotate on their own this often (paused while the pointer is on the card). */
export const TIP_INTERVAL_MS = 9000;

export function nextTip(index: number, count = LOGIN_TIPS.length): number {
  return count > 0 ? (index + 1) % count : 0;
}
