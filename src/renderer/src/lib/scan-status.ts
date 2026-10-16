// What the sidebar scan card and toolbar pill say, from the scan status. Pure; unit tested.
import type { ScanStatus } from '../../../shared/ipc';
import { ago } from './dates';

export type ScanState = 'idle' | 'ok' | 'scanning' | 'stale';

export interface ScanProgressView {
  done: number;
  total: number;
  newSoFar: number;
}

export interface ScanView {
  state: ScanState;
  title: string;
  detail: string;
  pill: string;
  /** Scan now is possible (sources exist and nothing is running). */
  canScan: boolean;
}

/** SPEC section 8: the heartbeat turns red when the last successful scan is older than 48 h. */
export const STALE_AFTER_MS = 48 * 3_600_000;
/** The pill says "Up to date" for this long after a successful scan. */
export const FRESH_FOR_MS = 12 * 3_600_000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function describeScan(
  status: ScanStatus | null,
  progress: ScanProgressView | null,
  now: Date,
): ScanView {
  if (!status) {
    return { state: 'idle', title: 'Checking scans…', detail: '', pill: '…', canScan: false };
  }
  if (status.running || progress) {
    const done = progress?.done ?? 0;
    const total = progress?.total ?? status.sourceCount;
    return {
      state: 'scanning',
      title: `Scanning ${done} of ${plural(total, 'source')}`,
      detail: `${plural(progress?.newSoFar ?? 0, 'new result')} so far`,
      pill: `Scanning ${done}/${total}`,
      canScan: false,
    };
  }
  if (status.sourceCount === 0) {
    return {
      state: 'idle',
      title: 'No sources yet',
      detail: 'Add sources to start scanning',
      pill: 'Not scanned',
      canScan: false,
    };
  }
  const run = status.lastRun;
  const failedNote =
    run && run.sources_failed ? plural(run.sources_failed, 'source') + ' failing' : null;
  if (!status.lastSuccessAt) {
    return run
      ? {
          state: 'stale',
          title: 'Last scan failed',
          detail: failedNote ?? 'No source answered',
          pill: 'Scan failed',
          canScan: true,
        }
      : {
          state: 'idle',
          title: 'No scans yet',
          detail: `${plural(status.sourceCount, 'source')} ready`,
          pill: 'Not scanned',
          canScan: true,
        };
  }
  const age = now.getTime() - new Date(status.lastSuccessAt).getTime();
  if (age > STALE_AFTER_MS) {
    const days = Math.floor(age / 86_400_000);
    return {
      state: 'stale',
      title: `Last success ${ago(status.lastSuccessAt, now)}`,
      detail: failedNote ?? `${plural(status.sourceCount, 'source')}`,
      pill: `Stale · ${plural(days, 'day')}`,
      canScan: true,
    };
  }
  const parts = [plural(run?.sources_ok ?? status.sourceCount, 'source')];
  if (failedNote) parts.push(failedNote);
  if (run?.new_items) parts.push(`${run.new_items} new`);
  return {
    state: 'ok',
    title: `Last scan ${ago(run?.finished_at ?? status.lastSuccessAt, now)}`,
    detail: parts.join(' · '),
    pill: age <= FRESH_FOR_MS ? 'Up to date' : `Scanned ${ago(status.lastSuccessAt, now)}`,
    canScan: true,
  };
}
