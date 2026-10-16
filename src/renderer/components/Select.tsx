import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';
import { Popover } from './Popover';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name of the control. */
  label: string;
  /** 'sm' = 26 px inline trigger (settings rows); 'md' = 32 px field. */
  size?: 'sm' | 'md';
  /** Shows a filter field; use for long lists such as time zones. */
  filterable?: boolean;
  align?: 'start' | 'end';
  className?: string;
}

/** Pop-up button with a glass listbox. Keyboard: Enter/Space/Arrow opens, arrows move, Enter picks. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
  filterable,
  align = 'end',
  className,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const current = options.find((o) => o.value === value);

  function openList() {
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function pick(option: SelectOption<T> | undefined) {
    if (!option) return;
    close();
    if (option.value !== value) onChange(option.value);
  }

  useEffect(() => {
    if (!open) return;
    (filterable ? filterRef.current : listRef.current)?.focus();
  }, [open, filterable]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function onListKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => Math.min(visible.length - 1, Math.max(0, a + d)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(visible[active]);
    } else if (e.key === 'Tab') {
      close(false);
    }
  }

  return (
    <div className={cn('app-no-drag relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            openList();
          }
        }}
        className={cn(
          'focus-ring inline-flex w-full items-center justify-between gap-1.5 bg-surface hairline border-line-2',
          'transition-colors duration-(--duration-base) ease-out hover:bg-surface-2',
          size === 'sm'
            ? 'h-6.5 rounded-sm pr-2 pl-2.5 text-subhead'
            : 'h-8 rounded-md pr-2 pl-2.5 text-body',
        )}
      >
        <span className="truncate">{current?.label ?? 'Choose…'}</span>
        <Icon icon={ChevronsUpDown} size={12} className="text-fg-3" />
      </button>

      <Popover open={open} onClose={() => close(false)} align={align} className="min-w-full">
        {filterable && (
          <div className="mb-1 flex h-7 items-center gap-2 rounded-xs bg-fill px-2 text-fg-3">
            <Icon icon={Search} size={13} />
            <input
              ref={filterRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onListKey}
              aria-label={`Filter ${label}`}
              aria-controls={listId}
              placeholder="Filter"
              className="min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-3"
            />
          </div>
        )}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onListKey}
          aria-activedescendant={visible[active] ? `${listId}-${active}` : undefined}
          className="max-h-80 min-w-(--popover-width) overflow-y-auto outline-none"
        >
          {visible.length === 0 && (
            <li className="px-2.5 py-1.5 text-body text-fg-3">No matches</li>
          )}
          {visible.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={cn(
                  'flex h-7 items-center gap-2 rounded-xs px-2.5 text-body whitespace-nowrap',
                  i === active ? 'bg-accent text-on-accent' : 'text-fg',
                )}
              >
                <span className="grid w-3.5 place-items-center">
                  {selected && <Icon icon={Check} size={12} stroke={2} />}
                </span>
                {o.label}
              </li>
            );
          })}
        </ul>
      </Popover>
    </div>
  );
}
