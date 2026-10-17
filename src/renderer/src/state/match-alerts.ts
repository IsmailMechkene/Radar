// "Show these matches": a new-match alert (notification click or toast action) asks the
// Opportunities page to filter to exactly those postings. The page may not be mounted yet when
// the request comes, so it is kept until the page takes it.
import { useSyncExternalStore } from 'react';

let requested: number[] | null = null;
const listeners = new Set<() => void>();

export function requestMatches(ids: readonly number[]): void {
  requested = [...ids];
  for (const l of listeners) l();
}

/** The page took the request (it is applied once). */
export function takeRequestedMatches(): void {
  requested = null;
  for (const l of listeners) l();
}

export function useRequestedMatches(): number[] | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => requested,
  );
}
