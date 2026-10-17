import { describe, expect, it } from 'vitest';
import { revealScrollTop, visibleRange } from '../src/renderer/components/lib/windowing';

const H = 56;

describe('visibleRange', () => {
  const at = (top: number, height = 560, count = 1000, overscan = 2) =>
    visibleRange({ count, rowHeight: H, overscan, top, height });

  it('covers the viewport plus the overscan on both sides', () => {
    // Viewport shows rows 10..19 (top at row 10, 10 rows tall).
    expect(at(10 * H)).toEqual({ start: 8, end: 22 });
    // Partly visible rows count as visible.
    expect(at(10 * H + 20)).toEqual({ start: 8, end: 23 });
  });

  it('starts at 0 while the list begins below the viewport top', () => {
    expect(at(-300)).toEqual({ start: 0, end: 7 });
    // Entirely below the viewport: nothing but the overscan.
    expect(at(-2000)).toEqual({ start: 0, end: 0 });
  });

  it('stays inside the list', () => {
    expect(at(995 * H)).toEqual({ start: 993, end: 1000 });
    expect(at(5000 * H)).toEqual({ start: 1000, end: 1000 });
    expect(at(0, 560, 3)).toEqual({ start: 0, end: 3 });
    expect(at(0, 560, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('revealScrollTop', () => {
  // List starts 300 px into the scroller; viewport is 560 px tall.
  const reveal = (index: number, scrollTop: number) =>
    revealScrollTop({ index, rowHeight: H, offset: 300, scrollTop, height: 560 });

  it('does nothing when the row is fully visible', () => {
    expect(reveal(0, 0)).toBeNull();
    expect(reveal(4, 300)).toBeNull();
  });

  it('scrolls up to the row top, or down to its bottom edge (nearest)', () => {
    expect(reveal(2, 1000)).toBe(300 + 2 * H);
    expect(reveal(20, 0)).toBe(300 + 21 * H - 560);
    // Partly hidden at the bottom: just enough to show it.
    expect(reveal(5, 0)).toBe(300 + 6 * H - 560);
  });
});
