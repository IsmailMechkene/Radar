import { useEffect, useState, type ReactNode } from 'react';
import type { AuthStatus } from '../../../shared/ipc';
import { lockView } from '../lib/lock';
import { cleanIpcError } from '../lib/settings-helpers';
import { rememberedTheme, useAppliedTheme } from '../state/theme';
import { LockErrorScreen, RecoveryKeyScreen, SetupScreen, UnlockScreen } from './LockScreens';

/** The lock screens follow the theme last used (settings are unreadable while locked). */
function Locked({ children }: { children: ReactNode }) {
  useAppliedTheme(rememberedTheme());
  return children;
}

/**
 * Renders the app only while Radar is unlocked and the recovery key is saved. Locking (toolbar or
 * tray) unmounts the whole app, so no page keeps data on screen or in memory.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    const off = window.radar.auth.onChanged(setStatus);
    window.radar.auth.status().then(setStatus, (err: unknown) => {
      console.error('[lock] status unavailable', err);
      setStatus({ state: 'error', message: cleanIpcError(err) });
    });
    return off;
  }, []);

  const view = lockView(status);
  if (view === 'app') return children;
  if (view === 'loading') return <div className="h-full w-full bg-bg" />;
  return (
    <Locked>
      {status?.state === 'setup' && (
        <SetupScreen hasPlainData={status.hasPlainData} onDone={setStatus} />
      )}
      {status?.state === 'unlocked' && status.recoveryKey && (
        <RecoveryKeyScreen recoveryKey={status.recoveryKey} onDone={setStatus} />
      )}
      {status?.state === 'locked' && <UnlockScreen onDone={setStatus} />}
      {status?.state === 'error' && <LockErrorScreen message={status.message} />}
    </Locked>
  );
}
