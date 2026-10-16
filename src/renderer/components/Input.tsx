import { Search } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean;
  /** 'sm' is the compact 24 px field used inline in settings rows (quiet hours, grade). */
  size?: 'sm' | 'md';
}

/**
 * Text field. 'md': 32 px on surface with a hairline border. 'sm': the design's 24 px filled
 * chip (quiet-hours times), borderless until focused.
 * Focus: 1 px accent border + soft accent ring. Invalid: red border and text.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid, size = 'md', className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'app-no-drag text-fg outline-none placeholder:text-fg-3',
        'transition-[box-shadow,border-color,background-color] duration-(--duration-base) ease-out',
        size === 'sm'
          ? 'h-6 rounded-xs bg-fill px-2 text-subhead tabular-nums focus:bg-surface'
          : 'h-8 rounded-md bg-surface px-2.5 text-body',
        invalid
          ? 'border border-red-fill text-red'
          : size === 'sm'
            ? 'border border-transparent focus:border-accent focus:shadow-focus'
            : 'hairline border-line-2 focus:border focus:border-accent focus:shadow-focus',
        className,
      )}
      {...rest}
    />
  );
});

/** Keyboard shortcut hint, e.g. "Ctrl K". */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-2xs hairline border-line-2 bg-surface px-1.5 py-px font-sans text-caption-2 text-fg-2">
      {children}
    </kbd>
  );
}

interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  shortcut?: string;
}

/** Toolbar search (30 px, filled). */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { shortcut, className, ...rest },
  ref,
) {
  return (
    <label
      className={cn(
        'app-no-drag flex h-7.5 items-center gap-2 rounded-md bg-fill hairline border-line px-2.5 text-fg-3',
        'transition-[background-color,box-shadow] duration-(--duration-base) ease-out hover:bg-fill-2',
        'focus-within:border-accent focus-within:shadow-focus',
        className,
      )}
    >
      <Icon icon={Search} size={14} />
      <input
        ref={ref}
        type="search"
        className="min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-3"
        {...rest}
      />
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </label>
  );
});
