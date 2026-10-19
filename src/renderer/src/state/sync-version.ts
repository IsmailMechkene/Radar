import { useEffect, useState } from 'react';

/**
 * Bumps when rows from another device were written here (sync). Pages add it to their load
 * effect, like scan.version, so they show the new data without a reload. The Rules page does not:
 * it would discard unsaved edits.
 */
export function useSyncVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => window.radar.sync.onApplied(() => setVersion((v) => v + 1)), []);
  return version;
}
