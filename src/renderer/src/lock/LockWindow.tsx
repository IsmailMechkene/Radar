import { useEffect, useState } from 'react';
import type { AuthStatus } from '../../../shared/ipc';
import { cleanIpcError } from '../lib/settings-helpers';
import { rememberedTheme, useAppliedTheme } from '../state/theme';
import { LockErrorScreen, RecoveryKeyScreen, SetupScreen, UnlockScreen } from './LockScreens';

/**
 * The login window (?window=lock): first-run setup, the recovery key, unlock and forgot password.
 * Once unlocked and the key is saved, main replaces this window with the app window.
 */
export function LockWindow() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  // Settings are unreadable while locked: use the theme last applied in the app.
  useAppliedTheme(rememberedTheme());

  useEffect(() => {
    // The brand row leaves room for the macOS traffic lights (tokens.css, .lock-brand).
    window.radar.app.getWindowInfo().then(
      (i) => (document.documentElement.dataset['platform'] = i.platform),
      (err: unknown) => console.error('[lock] window info unavailable', err),
    );
    const off = window.radar.auth.onChanged(setStatus);
    window.radar.auth.status().then(setStatus, (err: unknown) => {
      console.error('[lock] status unavailable', err);
      setStatus({ state: 'error', message: cleanIpcError(err) });
    });
    return off;
  }, []);

  if (status?.state === 'setup') {
    return <SetupScreen hasPlainData={status.hasPlainData} onDone={setStatus} />;
  }
  if (status?.state === 'locked') return <UnlockScreen onDone={setStatus} />;
  if (status?.state === 'error') return <LockErrorScreen message={status.message} />;
  if (status?.state === 'unlocked' && status.recoveryKey) {
    return <RecoveryKeyScreen recoveryKey={status.recoveryKey} onDone={setStatus} />;
  }
  // Loading, or unlocked: the app window is about to replace this one.
  return <div className="h-full w-full bg-bg" />;
}
