import { RefreshCw } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { ToolbarPill } from '../../components/Toolbar';
import { cn } from '../../components/lib/cn';

export type ScanState = 'idle' | 'ok' | 'scanning' | 'stale';

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

// No scanner exists yet (it arrives with the sources milestone), so the shell shows an honest
// idle state instead of the design's sample "Last scan 14 min ago".
const IDLE = {
  title: 'No scans yet',
  detail: 'Add sources to start scanning',
  pill: 'Not scanned',
};

/** Glass card at the bottom of the sidebar. */
export function ScanCard({ shortcut }: { shortcut: string }) {
  return (
    <div className="rounded-xl bg-glass hairline border-glass-border p-3 shadow-glass-card">
      <div className="flex items-center gap-2">
        <ScanDot state="idle" />
        <div className="text-subhead font-semibold">{IDLE.title}</div>
      </div>
      <div className="mt-0.75 mb-2.5 ml-4 text-caption text-fg-2">{IDLE.detail}</div>
      <button
        type="button"
        disabled
        title="Available once sources exist"
        className={cn(
          'focus-ring app-no-drag flex h-7 w-full items-center justify-center gap-1.5 rounded-sm',
          'bg-surface hairline border-line-2 text-subhead font-medium shadow-control disabled:opacity-50',
        )}
      >
        <Icon icon={RefreshCw} size={13} />
        <span>Scan now</span>
        <span className="ml-1 text-caption-2 text-fg-3">{shortcut}</span>
      </button>
    </div>
  );
}

export function ScanPill() {
  return <ToolbarPill dot={<ScanDot state="idle" />}>{IDLE.pill}</ToolbarPill>;
}
