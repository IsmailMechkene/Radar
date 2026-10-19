import type { SyncStatus } from '../../../shared/ipc';
import { ago } from './dates';

const changes = (n: number) => (n === 1 ? '1 change' : `${n} changes`);

/** How Settings > Account describes sync: badge and the sentence under the title. */
export function syncLabel(
  s: SyncStatus,
  now: Date,
): { text: string; tone: 'green' | 'amber' | 'red' | 'gray'; detail: string } {
  const last = s.lastSyncedAt ? `Last synced ${ago(s.lastSyncedAt, now)}.` : 'Not synced yet.';
  const waiting = s.pending > 0 ? ` ${changes(s.pending)} waiting to upload.` : '';
  switch (s.state) {
    case 'syncing':
      return { text: 'Syncing…', tone: 'gray', detail: `${last}${waiting}` };
    case 'synced':
      return s.message
        ? { text: 'Synced', tone: 'amber', detail: `${last} ${s.message}.` }
        : { text: 'Up to date', tone: 'green', detail: `${last}${waiting}` };
    case 'offline':
      return {
        text: 'Offline',
        tone: 'amber',
        detail: `${last}${waiting} Changes upload when you are back online.`,
      };
    case 'signed-out':
      return { text: 'Paused', tone: 'red', detail: `${last} Sign in again to sync.` };
    case 'needs-recovery-key':
      return { text: 'Needs your recovery key', tone: 'amber', detail: s.message ?? '' };
    case 'error':
      return { text: 'Not syncing', tone: 'red', detail: `${last} ${s.message ?? ''}`.trim() };
    case 'off':
      return {
        text: 'Off',
        tone: 'gray',
        detail: s.message ?? 'Starts once this computer is linked to your account.',
      };
  }
}
