import { useEffect, useState } from 'react';
import type { WindowInfo } from '../../shared/ipc';
import { ToastProvider } from '../components/Toast';
import { LockGate } from './lock/LockGate';
import { AppShell } from './shell/AppShell';
import { ScanProvider } from './state/scan';
import { SettingsProvider } from './state/settings';

export function App() {
  const [info, setInfo] = useState<WindowInfo | null>(null);

  useEffect(() => {
    window.radar.app.getWindowInfo().then(
      (i) => {
        setInfo(i);
        document.documentElement.dataset['platform'] = i.platform;
        document.documentElement.dataset['material'] = i.material;
      },
      (err: unknown) => console.error('[app] window info unavailable', err),
    );
  }, []);

  return (
    <ToastProvider>
      <LockGate>
        <SettingsProvider>
          <ScanProvider>
            <AppShell info={info} />
          </ScanProvider>
        </SettingsProvider>
      </LockGate>
    </ToastProvider>
  );
}
