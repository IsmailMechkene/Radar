import { Check } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

export interface OptionItem<T extends string> {
  value: T;
  label: string;
  /** Shown right-aligned, tabular, at 70% (e.g. how many results the option leaves). */
  count?: number;
}

interface OptionMenuProps<T extends string> {
  /** Accessible name; also the small heading when `showHeader`. */
  label: string;
  showHeader?: boolean;
  options: readonly OptionItem<T>[];
  selected: readonly T[];
  /** Called with the picked value. Single-choice menus usually close afterwards. */
  onPick: (value: T) => void;
  multi?: boolean;
  footer?: ReactNode;
}

/**
 * Checkable menu for filter popovers (design "Deadline window" menu): 28 px items, a check column,
 * optional counts. The highlighted item (hover or arrow keys) is accent-filled.
 * Keyboard: Up/Down move, Enter/Space pick.
 */
export function OptionMenu<T extends string>({
  label,
  showHeader = true,
  options,
  selected,
  onPick,
  multi,
  footer,
}: OptionMenuProps<T>) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => selected.includes(o.value)),
    ),
  );

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + d + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = options[active];
      if (o) onPick(o.value);
    }
  }

  return (
    <div className="w-59">
      {showHeader && (
        <div className="px-2.5 pt-1.5 pb-1 text-caption-2 font-semibold text-fg-3">{label}</div>
      )}
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-activedescendant={options[active] ? `${id}-${active}` : undefined}
        className="max-h-80 overflow-y-auto outline-none"
      >
        {options.map((o, i) => {
          const on = selected.includes(o.value);
          return (
            <div
              key={o.value}
              id={`${id}-${i}`}
              role={multi ? 'menuitemcheckbox' : 'menuitemradio'}
              aria-checked={on}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(o.value)}
              className={cn(
                'flex h-7 items-center gap-2 rounded-xs px-2.5 text-body whitespace-nowrap',
                i === active ? 'bg-accent text-on-accent' : 'text-fg',
              )}
            >
              <span className="inline-flex w-3.5">
                {on && <Icon icon={Check} size={14} stroke={2} />}
              </span>
              <span className="truncate">{o.label}</span>
              {o.count !== undefined && (
                <span className="ml-auto pl-3 text-caption tabular-nums opacity-70">{o.count}</span>
              )}
            </div>
          );
        })}
      </div>
      {footer && <div className="mt-1 hairline-t border-line pt-1">{footer}</div>}
    </div>
  );
}

/** Plain text action row for a menu footer, e.g. "Clear". */
export function MenuAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex h-7 w-full items-center rounded-xs px-2.5 text-body text-accent-text hover:bg-fill"
    >
      {children}
    </button>
  );
}
