import { RefreshCw } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { ToolbarPill } from '../../components/Toolbar';
import { cn } from '../../components/lib/cn';
import type { ScanState } from '../lib/scan-status';
import { useScan } from '../state/scan';

export type { ScanState };

const DOT_COLOR: Record<ScanState, string> = {
  idle: 'text-(--dot-idle)',
  ok: 'text-(--dot-ok)',
  scanning: 'text-(--dot-scanning)',
  stale: 'text-(--dot-stale)',
};

export function ScanDot({ state }: { state: ScanState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'scan-dot inline-block size-2 shrink-0 rounded-full',
        DOT_COLOR[state],
        state === 'scanning' && 'animate-pulse',
      )}
    />
  );
}

/** Glass card at the bottom of the sidebar: last scan, live progress, Scan now. */
export function ScanCard({ shortcut }: { shortcut: string }) {
  const { view, progress, scanNow } = useScan();
  const running = view.state === 'scanning';
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div
      aria-live="polite"
      className="rounded-xl bg-glass hairline border-glass-border p-3 shadow-glass-card"
    >
      <div className="flex items-center gap-2">
        <ScanDot state={view.state} />
        <div className="text-subhead font-semibold">{view.title}</div>
      </div>
      <div className="mt-0.75 mb-2.5 ml-4 text-caption text-fg-2">{view.detail}</div>
      {running && (
        <div
          role="progressbar"
          aria-label="Scan progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="mb-2.5 h-1 overflow-hidden rounded-full bg-fill-2"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-(--duration-base) ease-out"
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        </div>
      )}
      <button
        type="button"
        disabled={!view.canScan}
        onClick={scanNow}
        aria-keyshortcuts={shortcut.replace(' ', '+')}
        className={cn(
          'focus-ring app-no-drag flex h-7 w-full items-center justify-center gap-1.5 rounded-sm',
          'bg-surface hairline border-line-2 text-subhead font-medium shadow-control',
          'enabled:hover:brightness-96 disabled:opacity-50',
        )}
      >
        <Icon icon={RefreshCw} size={13} className={running ? 'animate-spin' : undefined} />
        <span>{running ? 'Scanning…' : 'Scan now'}</span>
        <span className="ml-1 text-caption-2 text-fg-3">{shortcut}</span>
      </button>
    </div>
  );
}

export function ScanPill() {
  const { view } = useScan();
  return <ToolbarPill dot={<ScanDot state={view.state} />}>{view.pill}</ToolbarPill>;
}
