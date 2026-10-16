import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ScanStatus, ScanSummary } from '../../../shared/ipc';
import { useToast } from '../../components/Toast';
import { describeScan, type ScanProgressView, type ScanView } from '../lib/scan-status';
import { cleanIpcError } from '../lib/settings-helpers';

interface ScanContextValue {
  view: ScanView;
  progress: ScanProgressView | null;
  /** Increments after every finished scan; pages reload their data when it changes. */
  version: number;
  scanNow: () => void;
}

const ScanContext = createContext<ScanContextValue | null>(null);

export function useScan(): ScanContextValue {
  const ctx = useContext(ScanContext);
  if (!ctx) throw new Error('useScan must be used inside <ScanProvider>');
  return ctx;
}

function finishedToast(s: ScanSummary) {
  const found = s.newItems === 1 ? '1 new opportunity' : `${s.newItems} new opportunities`;
  if (s.sourcesFailed && !s.sourcesOk) {
    return { tone: 'error' as const, message: `Scan failed · ${s.sourcesFailed} sources failed` };
  }
  if (s.sourcesFailed) {
    return {
      tone: 'error' as const,
      message: `Scan finished · ${found} · ${s.sourcesFailed} failed`,
    };
  }
  return { tone: 'success' as const, message: `Scan finished · ${found}` };
}

/** Scan status for the shell: card, pill, Scan now, and a reload signal for pages. */
export function ScanProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [progress, setProgress] = useState<ScanProgressView | null>(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const statusRef = useRef<ScanStatus | null>(null);

  const refresh = useCallback(() => {
    window.radar.scan.status().then(
      (s) => {
        statusRef.current = s;
        setStatus(s);
      },
      (err: unknown) => console.error('[scan] status failed', err),
    );
  }, []);

  useEffect(() => {
    refresh();
    // Relative times ("14 min ago") and staleness move with the clock.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    const offProgress = window.radar.scan.onProgress((p) =>
      setProgress((prev) => ({
        done: p.done,
        total: p.total,
        newSoFar: (prev?.newSoFar ?? 0) + p.outcome.inserted,
      })),
    );
    const offFinished = window.radar.scan.onFinished((summary) => {
      setProgress(null);
      setNow(new Date());
      setVersion((v) => v + 1);
      refresh();
      toast(finishedToast(summary));
    });
    return () => {
      clearInterval(timer);
      offProgress();
      offFinished();
    };
  }, [refresh, toast]);

  const scanNow = useCallback(() => {
    const s = statusRef.current;
    if (!s || s.running || s.sourceCount === 0) return;
    const optimistic = { ...s, running: true };
    statusRef.current = optimistic;
    setStatus(optimistic);
    setProgress({ done: 0, total: s.sourceCount, newSoFar: 0 });
    window.radar.scan.run().catch((err: unknown) => {
      console.error('[scan] run failed', err);
      setProgress(null);
      refresh();
      toast({ tone: 'error', message: `Scan failed: ${cleanIpcError(err)}` });
    });
  }, [refresh, toast]);

  const view = useMemo(() => describeScan(status, progress, now), [status, progress, now]);
  const value = useMemo(
    () => ({ view, progress, version, scanNow }),
    [view, progress, version, scanNow],
  );
  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}
