import { useCallback, useEffect, useState } from 'react';
import type { NavCounts } from '../../../shared/ipc';
import { DATA_CHANGED } from '../lib/data-events';
import { newSinceFor } from '../lib/opportunities';
import type { Route } from '../lib/router';
import { useScan } from './scan';
import { useSettings } from './settings';

const REFRESH_MS = 60_000;

/**
 * Sidebar counts, refreshed when the page changes, after a scan, when a page edits data, when the
 * window regains focus, and every minute. A failed refresh keeps the last counts (logged).
 */
export function useNavCounts(route: Route): NavCounts | null {
  const { settings } = useSettings();
  const scan = useScan();
  const [counts, setCounts] = useState<NavCounts | null>(null);
  const seenAt = settings ? settings.opportunitiesSeenAt : undefined;

  const refresh = useCallback(() => {
    if (seenAt === undefined) return; // settings not loaded yet
    window.radar.app
      .navCounts(newSinceFor(seenAt, new Date()))
      .then(setCounts, (err: unknown) => console.error('[nav] counts failed', err));
  }, [seenAt]);

  useEffect(() => {
    refresh();
  }, [refresh, route, scan.version]);

  useEffect(() => {
    const t = setInterval(refresh, REFRESH_MS);
    window.addEventListener(DATA_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener(DATA_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  return counts;
}
