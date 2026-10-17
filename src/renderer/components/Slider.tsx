import { useId, type ReactNode } from 'react';
import { cn } from './lib/cn';

interface SliderProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Shown right-aligned, tabular ("+12", "-25", "65"). */
  format?: (value: number) => string;
  /** Value differs from the saved one (a small accent mark). */
  changed?: boolean;
  /** 'wide': the track fills the row (thresholds); 'compact': a short track beside the label. */
  layout?: 'wide' | 'compact';
  /** 'red' for penalties: red track and value. */
  tone?: 'accent' | 'red';
  /**
   * Shown after the value (e.g. a button that opens the keywords behind the weight). Pass null on
   * rows without one so the columns still line up with rows that have it.
   */
  trailing?: ReactNode;
}

/**
 * Labelled range slider (design: weights and thresholds). Native input for keyboard and screen
 * readers (arrows, Page Up/Down, Home/End); accent (or red) track via the accent color.
 */
export function Slider({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  changed,
  layout = 'wide',
  tone = 'accent',
  trailing,
}: SliderProps) {
  const id = useId();
  return (
    <div
      className={cn(
        'grid items-center gap-3.5 py-2',
        // A trailing column (even an empty one, trailing={null}) keeps rows of a card aligned.
        layout === 'compact'
          ? trailing !== undefined
            ? 'grid-cols-[minmax(0,1fr)_13rem_44px_8.5rem]'
            : 'grid-cols-[minmax(0,1fr)_13rem_44px]'
          : trailing !== undefined
            ? 'grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_44px_auto]'
            : 'grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_44px]',
      )}
    >
      <div className="min-w-0">
        <label htmlFor={id} className="block truncate text-body font-medium">
          {label}
          {changed && (
            <span
              aria-label="changed"
              className="ml-1.5 inline-block size-1.5 rounded-full bg-accent align-middle"
            />
          )}
        </label>
        {description && <div className="truncate text-footnote text-fg-3">{description}</div>}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          'focus-ring h-1.5 w-full cursor-pointer appearance-auto rounded-full',
          tone === 'red' ? 'accent-red' : 'accent-accent',
        )}
      />
      <output
        htmlFor={id}
        className={cn(
          'text-right text-body font-semibold tabular-nums',
          tone === 'red' && 'text-red',
        )}
      >
        {format ? format(value) : value}
      </output>
      {trailing !== undefined && <div className="flex justify-end">{trailing}</div>}
    </div>
  );
}
