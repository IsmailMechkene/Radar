import { useCallback, useEffect, useState } from 'react';
import type { CopilotItem, CopilotStatus } from '../../../../shared/ipc';
import { cleanIpcError } from '../../lib/settings-helpers';
import { useScan } from '../../state/scan';
import { useSyncVersion } from '../../state/sync-version';

/** Copilot items and the live queue status; reloads after each review, scan and sync. */
export function useCopilot() {
  const [items, setItems] = useState<CopilotItem[] | null>(null);
  const [status, setStatus] = useState<CopilotStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      window.radar.copilot.list().then(
        (list) => {
          setItems(list);
          setError(null);
        },
        (err: unknown) => {
          console.error('[copilot] load failed', err);
          setError(cleanIpcError(err));
        },
      ),
    [],
  );

  const scanVersion = useScan().version;
  const synced = useSyncVersion();
  useEffect(() => {
    void reload();
  }, [reload, scanVersion, synced]);

  useEffect(() => {
    window.radar.copilot.status().then(setStatus, (err: unknown) => {
      console.error('[copilot] status failed', err);
    });
    return window.radar.copilot.onChanged(setStatus);
  }, []);

  // A review finished (or a run ended): show it.
  const done = status?.done ?? 0;
  const running = status?.running ?? false;
  const failed = status?.failures.length ?? 0;
  useEffect(() => {
    void reload();
  }, [reload, done, running, failed]);

  return { items, status, setStatus, error, reload };
}
