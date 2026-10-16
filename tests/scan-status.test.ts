import { describe, expect, it } from 'vitest';
import type { ScanStatus } from '../src/shared/ipc';
import { ago } from '../src/renderer/src/lib/dates';
import { describeScan } from '../src/renderer/src/lib/scan-status';

const NOW = new Date('2026-10-16T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function status(over: Partial<ScanStatus> = {}): ScanStatus {
  return { running: false, sourceCount: 6, lastRun: null, lastSuccessAt: null, ...over };
}

function run(finishedHoursAgo: number, ok: number, failed: number, newItems: number) {
  return {
    id: 1,
    started_at: hoursAgo(finishedHoursAgo + 0.01),
    finished_at: hoursAgo(finishedHoursAgo),
    trigger: 'manual' as const,
    sources_ok: ok,
    sources_failed: failed,
    new_items: newItems,
    error_summary: null,
  };
}

describe('ago', () => {
  it('reads like the design', () => {
    expect(ago(hoursAgo(0), NOW)).toBe('just now');
    expect(ago(hoursAgo(14 / 60), NOW)).toBe('14 min ago');
    expect(ago(hoursAgo(3), NOW)).toBe('3 h ago');
    expect(ago(hoursAgo(25), NOW)).toBe('1 day ago');
    expect(ago(hoursAgo(72), NOW)).toBe('3 days ago');
  });
});

describe('describeScan', () => {
  it('no status yet, no sources, never scanned', () => {
    expect(describeScan(null, null, NOW)).toMatchObject({ canScan: false });
    expect(describeScan(status({ sourceCount: 0 }), null, NOW)).toMatchObject({
      state: 'idle',
      title: 'No sources yet',
      canScan: false,
    });
    expect(describeScan(status(), null, NOW)).toMatchObject({
      state: 'idle',
      title: 'No scans yet',
      detail: '6 sources ready',
      pill: 'Not scanned',
      canScan: true,
    });
  });

  it('scanning shows progress and blocks Scan now', () => {
    expect(
      describeScan(status({ running: true }), { done: 2, total: 6, newSoFar: 1 }, NOW),
    ).toEqual({
      state: 'scanning',
      title: 'Scanning 2 of 6 sources',
      detail: '1 new result so far',
      pill: 'Scanning 2/6',
      canScan: false,
    });
  });

  it('fresh, older, failing and stale (48 h heartbeat)', () => {
    expect(
      describeScan(
        status({ lastRun: run(0.25, 6, 0, 12), lastSuccessAt: hoursAgo(0.25) }),
        null,
        NOW,
      ),
    ).toMatchObject({
      state: 'ok',
      title: 'Last scan 15 min ago',
      detail: '6 sources · 12 new',
      pill: 'Up to date',
    });
    expect(
      describeScan(status({ lastRun: run(20, 5, 1, 0), lastSuccessAt: hoursAgo(20) }), null, NOW),
    ).toMatchObject({
      state: 'ok',
      detail: '5 sources · 1 source failing',
      pill: 'Scanned 20 h ago',
    });
    expect(
      describeScan(status({ lastRun: run(72, 6, 0, 0), lastSuccessAt: hoursAgo(72) }), null, NOW),
    ).toMatchObject({ state: 'stale', title: 'Last success 3 days ago', pill: 'Stale · 3 days' });
    expect(describeScan(status({ lastRun: run(1, 0, 6, 0) }), null, NOW)).toMatchObject({
      state: 'stale',
      title: 'Last scan failed',
      detail: '6 sources failing',
      canScan: true,
    });
  });
});
