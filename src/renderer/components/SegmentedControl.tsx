import type { LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Icon-only segments still need `label` for assistive tech. */
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  segments: readonly Segment<T>[];
  label: string;
  iconOnly?: boolean;
}

/** Segmented control (radiogroup). Arrow keys move the selection. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  segments,
  label,
  iconOnly,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + segments.length) % segments.length;
    const seg = segments[next];
    if (!seg) return;
    onChange(seg.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="app-no-drag inline-flex shrink-0 rounded-md bg-fill hairline border-line p-0.5"
    >
      {segments.map((seg, i) => {
        const on = seg.value === value;
        return (
          <button
            key={seg.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={iconOnly ? seg.label : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(seg.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'focus-ring flex h-6 items-center justify-center gap-1.5 text-subhead',
              'transition-[background-color,color] duration-(--duration-base) ease-out',
              iconOnly ? 'w-7.5 rounded-2xs' : 'rounded-xs px-3',
              on ? 'bg-control font-medium text-fg shadow-segment' : 'text-fg-2 hover:text-fg',
            )}
          >
            {seg.icon && <Icon icon={seg.icon} size={14} />}
            {!iconOnly && seg.label}
          </button>
        );
      })}
    </div>
  );
}
