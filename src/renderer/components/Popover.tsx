import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Horizontal alignment to the (relative) parent that wraps the anchor. */
  align?: 'start' | 'end';
  className?: string;
}

/**
 * Glass popover anchored below its relative parent. Closes on outside click and Escape.
 * Scale 0.96 -> 1 with a fade (design: spring 400 / 32, approximated with an overshoot curve).
 */
export function Popover({ open, onClose, children, align = 'start', className }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const parent = ref.current?.parentElement;
      if (parent && !parent.contains(e.target as Node)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cn(
        'absolute top-full z-30 mt-1 rounded-xl bg-glass backdrop-glass hairline border-glass-border p-1.25 shadow-pop',
        'animate-pop-in',
        align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface MenuItemDef {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string;
  destructive?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface MenuProps {
  items: readonly MenuItemDef[];
  label: string;
  /** Index highlighted initially (the design shows one highlighted item). */
  initialActive?: number;
  autoFocus?: boolean;
}

/** Menu list for a Popover: 28 px items, highlighted item is accent-filled. Arrow keys + Enter. */
export function Menu({ items, label, initialActive = -1, autoFocus }: MenuProps) {
  const [active, setActive] = useState(initialActive);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + d + items.length) % items.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      items[active]?.onSelect();
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-activedescendant={items[active] ? `menu-${items[active].id}` : undefined}
      className="w-(--popover-width) outline-none"
    >
      {items.map((item, i) => (
        <div key={item.id}>
          {item.separatorBefore && <div className="mx-2 my-1 hairline-t border-line" />}
          <div
            id={`menu-${item.id}`}
            role="menuitem"
            onMouseEnter={() => setActive(i)}
            onClick={item.onSelect}
            className={cn(
              'flex h-7 items-center gap-2 rounded-xs px-2.5 text-body',
              i === active ? 'bg-accent text-on-accent' : item.destructive ? 'text-red' : 'text-fg',
            )}
          >
            {item.icon && <Icon icon={item.icon} size={14} />}
            {item.label}
            {item.shortcut && (
              <span className="ml-auto text-caption opacity-70">{item.shortcut}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
