import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';
import { WindowControls } from './WindowControls';

/**
 * 52 px window toolbar. It is the window's drag region; interactive children opt out. On Windows
 * and Linux the window buttons end it, flush with the window's corner (`windowControls` false for
 * a sample that is not the window's toolbar).
 */
export function Toolbar({
  children,
  windowControls = true,
}: {
  children: ReactNode;
  windowControls?: boolean;
}) {
  return (
    <header className="app-drag relative flex h-(--toolbar-height) shrink-0 items-center gap-2.5 hairline-b border-line px-5">
      {children}
      {windowControls && <WindowControls className="-mr-5 ml-2" />}
    </header>
  );
}

export function ToolbarTitle({ children }: { children: ReactNode }) {
  return <div className="min-w-27.5 text-headline font-semibold tracking-title-3">{children}</div>;
}

interface ToolbarButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Toolbar chevrons are 18 px; other toolbar icons 16 px. */
  size?: 16 | 18;
  tone?: 'secondary' | 'tertiary';
}

/** 28 px square icon button for the toolbar. */
export function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
  size = 16,
  tone = 'secondary',
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'focus-ring app-no-drag grid size-7 place-items-center rounded-sm',
        'transition-colors duration-(--duration-base) ease-out enabled:hover:bg-fill disabled:opacity-50',
        size === 18 ? 'rounded-xs' : 'rounded-sm',
        tone === 'secondary' ? 'text-fg-2' : 'text-fg-3',
      )}
    >
      <Icon icon={icon} size={size} />
    </button>
  );
}

/** Status pill at the right of the toolbar (28 px), e.g. scan state. */
export function ToolbarPill({ dot, children }: { dot: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-7 items-center gap-1.75 rounded-full bg-fill hairline border-line px-2.75 text-footnote font-medium whitespace-nowrap text-fg-2">
      {dot}
      <span className="tabular-nums">{children}</span>
    </div>
  );
}
