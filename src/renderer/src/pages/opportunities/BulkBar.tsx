import { ArchiveX, Plus, Star, X, type LucideIcon } from 'lucide-react';
import { Icon } from '../../../components/Icon';
import { ColumnPortal } from '../../../components/Overlay';
import { cn } from '../../../components/lib/cn';

function BarButton({
  icon,
  label,
  hint,
  primary,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts={hint}
      className={cn(
        'focus-ring flex h-7.5 items-center gap-1.5 rounded-full text-body',
        primary
          ? 'bg-accent px-3.5 font-semibold text-on-accent hover:brightness-96'
          : 'px-3 font-medium hover:bg-fill-2',
      )}
    >
      <Icon icon={icon} size={14} />
      {label}
      {hint && <span className="text-caption-2 text-fg-3">{hint}</span>}
    </button>
  );
}

interface BulkBarProps {
  count: number;
  allStarred: boolean;
  onStar: () => void;
  onDismiss: () => void;
  onPipeline: () => void;
  onClear: () => void;
}

/** Floating glass bar while rows are checked (design: bottom centre of the content column). */
export function BulkBar({
  count,
  allStarred,
  onStar,
  onDismiss,
  onPipeline,
  onClear,
}: BulkBarProps) {
  if (count === 0) return null;
  return (
    <ColumnPortal>
      <div
        role="toolbar"
        aria-label={`${count} selected`}
        className={cn(
          'absolute bottom-6 left-1/2 z-25 flex -translate-x-1/2 items-center gap-1 rounded-full py-1.5 pr-1.5 pl-4 whitespace-nowrap',
          'bg-glass backdrop-glass hairline border-glass-border shadow-pop animate-toast-in',
        )}
      >
        <span className="mr-2 text-body font-semibold tabular-nums">{count} selected</span>
        <BarButton icon={Star} label={allStarred ? 'Unstar' : 'Star'} hint="S" onClick={onStar} />
        <BarButton icon={ArchiveX} label="Dismiss" hint="X" onClick={onDismiss} />
        <BarButton icon={Plus} label="Add to pipeline" primary onClick={onPipeline} />
        <button
          type="button"
          aria-label="Clear selection"
          onClick={onClear}
          className="focus-ring grid size-7.5 place-items-center rounded-full text-fg-2 hover:bg-fill-2"
        >
          <Icon icon={X} size={14} />
        </button>
      </div>
    </ColumnPortal>
  );
}
