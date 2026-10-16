import { ChevronDown, X, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

interface FilterPillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  /** Active filters are tinted with the accent and show a clear (x) affordance. */
  active?: boolean;
}

/** Filter pill (26 px). Inactive opens a filter menu (chevron); active is tinted. */
export function FilterPill({ label, active, className, ...rest }: FilterPillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'focus-ring inline-flex h-6.5 items-center gap-1.25 rounded-full px-2.5 text-footnote font-medium',
        'transition-colors duration-(--duration-base) ease-out',
        active
          ? 'bg-accent-soft text-accent-text'
          : 'bg-surface hairline border-line-2 hover:bg-fill',
        className,
      )}
      {...rest}
    >
      {label}
      <Icon icon={active ? X : ChevronDown} size={12} />
    </button>
  );
}

interface ChipProps {
  label: string;
  tone?: 'default' | 'danger';
  /** When set, a remove (x) button is shown. */
  onRemove?: () => void;
  removeDisabled?: boolean;
  className?: string;
}

/** Token chip (24 px): keyword lists, roles, regions. Removable with an x button. */
export function Chip({ label, tone = 'default', onRemove, removeDisabled, className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.25 rounded-full text-subhead font-medium',
        onRemove ? 'pr-1.5 pl-2.5' : 'px-2.5',
        tone === 'danger' ? 'bg-red-soft text-red' : 'bg-fill hairline border-line',
        className,
      )}
    >
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          aria-label={`Remove ${label}`}
          className={cn(
            'focus-ring grid size-4 place-items-center rounded-full disabled:opacity-40',
            tone === 'danger' ? '' : 'text-fg-3',
            'enabled:hover:bg-fill-2',
          )}
        >
          <Icon icon={X} size={11} />
        </button>
      )}
    </span>
  );
}

/** Merge-field tag (20 px, radius 6), e.g. [first name] in outreach templates. */
export function Tag({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 items-center rounded-xs bg-accent-soft px-1.75 text-footnote font-medium text-accent-text">
      {label}
    </span>
  );
}

/** Small meta chip (20 px) with an icon, e.g. "Remote". */
export function MetaChip({ label, icon }: { label: string; icon?: LucideIcon }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-fill px-1.75 text-caption-2 font-medium text-fg-2">
      {icon && <Icon icon={icon} size={11} />}
      {label}
    </span>
  );
}
