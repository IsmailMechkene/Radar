import { useId } from 'react';
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
}

/**
 * Labelled range slider (design: weights and thresholds). Native input for keyboard and screen
 * readers (arrows, Page Up/Down, Home/End); accent track via the accent color.
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
}: SliderProps) {
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_44px] items-center gap-3.5 py-2">
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
          'focus-ring h-1.5 w-full cursor-pointer appearance-auto rounded-full accent-accent',
        )}
      />
      <output htmlFor={id} className="text-right text-body font-semibold tabular-nums">
        {format ? format(value) : value}
      </output>
    </div>
  );
}
