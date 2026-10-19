import { useEffect } from 'react';

// How many dimming scrims (dialogs) are open. The app shell listens and dims the native window
// controls with them, which the page's own scrim cannot cover.
let open = 0;
const listeners = new Set<(dimmed: boolean) => void>();

export function onScrimChange(listener: (dimmed: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function scrimIsOpen(): boolean {
  return open > 0;
}

/** Counts this scrim as open while `active`. */
export function useScrim(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    open += 1;
    if (open === 1) for (const l of listeners) l(true);
    return () => {
      open -= 1;
      if (open === 0) for (const l of listeners) l(false);
    };
  }, [active]);
}
