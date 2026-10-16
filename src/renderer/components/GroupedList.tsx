import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

export type TileTone = 'red' | 'sky' | 'indigo' | 'gray' | 'blue' | 'teal' | 'green';

const TILE: Record<TileTone, string> = {
  red: 'bg-tile-red',
  sky: 'bg-tile-sky',
  indigo: 'bg-tile-indigo',
  gray: 'bg-tile-gray',
  blue: 'bg-tile-blue',
  teal: 'bg-tile-teal',
  green: 'bg-tile-green',
};

/** 26 px colored square with a white 14 px icon (settings rows). */
export function IconTile({
  icon,
  tone,
  className,
}: {
  icon: LucideIcon;
  tone: TileTone;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'grid size-6.5 shrink-0 place-items-center rounded-sm text-on-accent',
        TILE[tone],
        className,
      )}
    >
      <Icon icon={icon} size={14} stroke={2} />
    </div>
  );
}

/** Settings-style group: 13/600 heading, then a radius-14 card with hairline-separated rows. */
export function GroupedSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mb-5.5">
      <h2 id={id} className="mx-1 mb-2 text-body font-semibold">
        {title}
      </h2>
      <div className="rounded-2xl bg-surface hairline border-line shadow-card">{children}</div>
    </section>
  );
}

interface GroupedRowProps {
  icon: LucideIcon;
  tile: TileTone;
  title: string;
  description?: ReactNode;
  /** Trailing control(s), right-aligned. */
  children?: ReactNode;
  /** Content under the title, e.g. a chip list. */
  below?: ReactNode;
}

/** 48 px minimum row: tile, title + description, trailing control. */
export function GroupedRow({ icon, tile, title, description, children, below }: GroupedRowProps) {
  return (
    <div className="flex min-h-12 items-center gap-3 px-4 py-2 not-first:hairline-t border-line">
      {/* Tall rows (chip lists) keep the tile beside the title instead of centred. */}
      <IconTile icon={icon} tone={tile} className={below ? 'self-start mt-0.5' : undefined} />
      <div className="min-w-0 flex-1">
        <div className="text-body">{title}</div>
        {description && <div className="text-caption text-fg-3">{description}</div>}
        {below && <div className="mt-2">{below}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
