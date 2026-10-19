import { useEffect, useState } from 'react';
import type { AuthStatus } from '../../../shared/ipc';
import { cleanIpcError } from '../lib/settings-helpers';
import { rememberedTheme, useAppliedTheme } from '../state/theme';
import {
  BrowserScreen,
  CheckEmailScreen,
  ChoosePasswordScreen,
  NewPasswordScreen,
  PasswordChangedScreen,
  SignInScreen,
} from './AccountScreens';
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

  const done = setStatus;
  switch (status?.state) {
    case 'setup':
      return <SetupScreen hasPlainData={status.hasPlainData} onDone={done} />;
    case 'signin':
      // Keyed by purpose so a new sign-in (e.g. after signing out) starts from empty fields.
      return (
        <SignInScreen
          key={status.purpose}
          purpose={status.purpose}
          account={status.account}
          hasPlainData={status.hasPlainData}
          problem={status.problem}
          onDone={done}
        />
      );
    case 'check-email':
      return (
        <CheckEmailScreen
          email={status.email}
          purpose={status.purpose}
          problem={status.problem}
          onDone={done}
        />
      );
    case 'browser':
      return <BrowserScreen onDone={done} />;
    case 'choose-password':
      return (
        <ChoosePasswordScreen
          account={status.account}
          hasPlainData={status.hasPlainData}
          onDone={done}
        />
      );
    case 'new-password':
      return <NewPasswordScreen account={status.account} hasData={status.hasData} onDone={done} />;
    case 'password-changed':
      return <PasswordChangedScreen account={status.account} onDone={done} />;
    case 'locked':
      return <UnlockScreen account={status.account} onDone={done} />;
    case 'error':
      return <LockErrorScreen message={status.message} />;
    case 'unlocked':
      if (status.recoveryKey) {
        return <RecoveryKeyScreen recoveryKey={status.recoveryKey} onDone={done} />;
      }
  }
  // Loading, or unlocked: the app window is about to replace this one.
  return <div className="h-full w-full bg-bg" />;
}
