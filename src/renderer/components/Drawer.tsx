import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  label: string;
  /** 520 px at >= 1200 px window width, 440 px below. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * Detail drawer: slides over the content from the right, below the toolbar.
 * Esc closes; focus moves into the drawer on open and back to the opener on close.
 */
export function Drawer({ open, onClose, label, wide = true, children }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={cn(
        'absolute top-(--toolbar-height) right-0 bottom-0 z-20 flex flex-col outline-none',
        'bg-surface hairline-l border-line shadow-drawer animate-drawer-in',
        // The shadow only falls to the left: unclipped, its blur reached up into the toolbar and
        // left a lighter box behind the native window controls (which are painted over it).
        '[clip-path:inset(0_0_0_-64px)]',
        wide ? 'w-(--drawer-width)' : 'w-(--drawer-width-narrow)',
      )}
    >
      {children}
    </div>
  );
}

/** Round 28 px close button for the drawer header. */
export function DrawerClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className="focus-ring grid size-7 place-items-center rounded-full bg-fill text-fg-2 hover:bg-fill-2"
    >
      <Icon icon={X} size={15} />
    </button>
  );
}
