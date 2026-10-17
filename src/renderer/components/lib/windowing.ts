// Windowed lists of fixed-height rows: only the rows near the viewport are rendered, and padding
// of the exact height stands in for the rest. Pure, so the math is tested without a DOM.

export interface RowRange {
  /** First rendered row (inclusive). */
  start: number;
  /** Last rendered row (exclusive). */
  end: number;
}

/**
 * Rows to render. `top` is the scroll position measured from the list's first row (negative while
 * the list starts below the viewport top); `height` is the viewport height.
 */
export function visibleRange(o: {
  count: number;
  rowHeight: number;
  overscan: number;
  top: number;
  height: number;
}): RowRange {
  const first = Math.floor(o.top / o.rowHeight) - o.overscan;
  const last = Math.ceil((o.top + o.height) / o.rowHeight) + o.overscan;
  const start = Math.max(0, Math.min(o.count, first));
  return { start, end: Math.max(start, Math.min(o.count, last)) };
}

/**
 * Scroll position that brings row `index` fully into view with the least movement (like
 * scrollIntoView 'nearest'), or null when it is already visible. `offset` is the list's top
 * within the scroll container's content.
 */
export function revealScrollTop(o: {
  index: number;
  rowHeight: number;
  offset: number;
  scrollTop: number;
  height: number;
}): number | null {
  const top = o.offset + o.index * o.rowHeight;
  const bottom = top + o.rowHeight;
  if (top < o.scrollTop) return top;
  if (bottom > o.scrollTop + o.height) return bottom - o.height;
  return null;
}
