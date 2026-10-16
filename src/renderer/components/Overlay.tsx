import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hosts for floating UI that must not scroll with page content:
 * - `column`: positioned against the content column (drawer, bulk-action bar).
 * - `window`: positioned against the whole window (dialogs and their scrim).
 */
interface Hosts {
  column: HTMLElement | null;
  window: HTMLElement | null;
}

const OverlayContext = createContext<Hosts>({ column: null, window: null });

export function OverlayProvider({ hosts, children }: { hosts: Hosts; children: ReactNode }) {
  return <OverlayContext.Provider value={hosts}>{children}</OverlayContext.Provider>;
}

export function ColumnPortal({ children }: { children: ReactNode }) {
  const { column } = useContext(OverlayContext);
  return column ? createPortal(children, column) : null;
}

export function WindowPortal({ children }: { children: ReactNode }) {
  const { window: host } = useContext(OverlayContext);
  return host ? createPortal(children, host) : null;
}
