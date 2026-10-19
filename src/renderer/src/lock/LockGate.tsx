import { useEffect, useState, type ReactNode } from 'react';
import type { AuthStatus } from '../../../shared/ipc';
import { lockView } from '../lib/lock';

/**
 * The app window renders the app only while Radar is unlocked and the recovery key is saved.
 * Main swaps this window for the login window on lock; until it closes, nothing is shown, and the
 * whole app (providers included) is unmounted so no page keeps data in memory.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    const off = window.radar.auth.onChanged(setStatus);
    window.radar.auth.status().then(setStatus, (err: unknown) => {
      console.error('[lock] status unavailable', err);
    });
    return off;
  }, []);

  return lockView(status) === 'app' ? children : <div className="h-full w-full bg-bg" />;
}
