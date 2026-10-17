import { useCallback, useLayoutEffect, useState } from 'react';
import { revealScrollTop, visibleRange, type RowRange } from './windowing';

/** The nearest scrolling ancestor (the shell's <main> for page content). */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return document.documentElement;
}

/**
 * Windowing for a list of `count` rows of `rowHeight` px inside a scrolling ancestor. Pass
 * `attach` as the ref of the element that holds the rows, render rows [start, end) and pad it with
 * `paddingTop` / `paddingBottom`. Follows scrolling and any size change of the scroller or the
 * content above the list. `scrollToIndex` reveals a row that may not be rendered yet.
 */
export function useWindowedRows(count: number, rowHeight: number, overscan = 10) {
  const [list, attach] = useState<HTMLDivElement | null>(null);
  const [range, setRange] = useState<RowRange>(() => ({
    start: 0,
    end: Math.min(count, Math.ceil(window.innerHeight / rowHeight) + overscan),
  }));

  const measure = useCallback(() => {
    if (!list) return null;
    const scroller = scrollParent(list);
    const offset =
      list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    return { scroller, offset };
  }, [list]);

  const update = useCallback(() => {
    const m = measure();
    if (!m) return;
    const next = visibleRange({
      count,
      rowHeight,
      overscan,
      top: m.scroller.scrollTop - m.offset,
      height: m.scroller.clientHeight,
    });
    setRange((r) => (r.start === next.start && r.end === next.end ? r : next));
  }, [measure, count, rowHeight, overscan]);

  // Layout effect + ResizeObserver: an observer reports each target once right away, before the
  // next paint, so the right rows are in place before anything is drawn.
  useLayoutEffect(() => {
    const m = measure();
    if (!m) return;
    m.scroller.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(m.scroller);
    for (const child of m.scroller.children) resize.observe(child);
    return () => {
      m.scroller.removeEventListener('scroll', update);
      resize.disconnect();
    };
  }, [measure, update]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const m = measure();
      if (!m) return;
      const top = revealScrollTop({
        index,
        rowHeight,
        offset: m.offset,
        scrollTop: m.scroller.scrollTop,
        height: m.scroller.clientHeight,
      });
      if (top !== null) m.scroller.scrollTop = top;
    },
    [measure, rowHeight],
  );

  const start = Math.min(range.start, count);
  const end = Math.min(Math.max(range.end, start), count);
  return {
    attach,
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: (count - end) * rowHeight,
    scrollToIndex,
  };
}
