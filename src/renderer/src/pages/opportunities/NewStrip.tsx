import { CircleDashed, Clock, Minus } from 'lucide-react';
import type { OpportunityListItem } from '../../../../shared/ipc';
import { VerdictBadge } from '../../../components/Badge';
import { OrgAvatar } from '../../../components/Brand';
import { Icon } from '../../../components/Icon';
import { MetaChip } from '../../../components/Pill';
import { ScoreRing } from '../../../components/ScoreRing';
import { Shimmer, Skeleton } from '../../../components/Skeleton';
import { cn } from '../../../components/lib/cn';
import { formatVisit } from '../../lib/dates';
import {
  deadlineChip,
  monogram,
  monogramHue,
  REMOTE_LABELS,
  type Ctx,
  type DeadlineTone,
} from '../../lib/opportunities';
import { REMOTE_ICONS } from './icons';

const TONE_TEXT: Record<DeadlineTone, string> = {
  red: 'text-red',
  amber: 'text-amber',
  neutral: 'text-fg-2',
  none: 'text-fg-3',
};

function StripCard({
  item,
  ctx,
  onOpen,
}: {
  item: OpportunityListItem;
  ctx: Ctx;
  onOpen: () => void;
}) {
  const chip = deadlineChip(item, ctx);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'focus-ring flex min-w-0 flex-col gap-2.5 rounded-2xl bg-surface p-3.5 text-left hairline border-line shadow-card',
        'transition-[transform,box-shadow] duration-(--duration-lift) ease-out hover:-translate-y-0.5 hover:shadow-pop',
      )}
    >
      <div className="flex items-start justify-between">
        <OrgAvatar initials={monogram(item.org)} hue={monogramHue(item.org)} />
        <ScoreRing score={item.score} size="card" />
      </div>
      <div className="min-h-9 text-headline leading-[1.3] font-semibold tracking-title-3 clamp-2">
        {item.title}
      </div>
      <div className="-mt-1.5 truncate text-footnote text-fg-2">
        {[item.org, item.location].filter(Boolean).join(' · ')}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <MetaChip label={REMOTE_LABELS[item.remote_type]} icon={REMOTE_ICONS[item.remote_type]} />
        <VerdictBadge verdict={item.verdict} size="sm" />
      </div>
      <div
        className={cn(
          'mt-auto flex items-center gap-1.25 hairline-t border-line pt-2.5 text-caption font-medium',
          TONE_TEXT[chip.tone],
        )}
      >
        <Icon icon={chip.days === null ? Minus : chip.expected ? CircleDashed : Clock} size={12} />
        {chip.long}
      </div>
    </button>
  );
}

interface NewStripProps {
  items: OpportunityListItem[];
  total: number;
  ctx: Ctx;
  columns: number;
  lastVisit: string | null;
  onOpen: (id: number) => void;
  onSeeAll: () => void;
}

/** "New since your last visit": the best new results as cards above the table. */
export function NewStrip({
  items,
  total,
  ctx,
  columns,
  lastVisit,
  onOpen,
  onSeeAll,
}: NewStripProps) {
  return (
    <section aria-label="New since your last visit" className="mb-7">
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="m-0 text-caption-2 font-semibold tracking-caps text-fg-3 uppercase">
          New since your last visit
        </h2>
        {lastVisit && (
          <div className="text-footnote text-fg-3">{formatVisit(lastVisit, ctx.timeZone)}</div>
        )}
        {total > items.length && (
          <button
            type="button"
            onClick={onSeeAll}
            className="focus-ring ml-auto rounded-xs text-subhead font-medium text-accent-text"
          >
            See all {total}
          </button>
        )}
      </div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {items.map((i) => (
          <StripCard key={i.id} item={i} ctx={ctx} onOpen={() => onOpen(i.id)} />
        ))}
      </div>
    </section>
  );
}

export function NewStripSkeleton({ columns }: { columns: number }) {
  return (
    <div
      aria-hidden="true"
      className="mb-7 grid gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: columns }, (_, i) => (
        <div
          key={i}
          className="relative flex h-45.5 flex-col gap-2.5 overflow-hidden rounded-2xl bg-surface p-3.5 hairline border-line"
        >
          <div className="flex justify-between">
            <Skeleton strong className="size-8 rounded-md" />
            <Skeleton strong className="size-10 rounded-full" />
          </div>
          <Skeleton strong className="h-3 w-[90%]" />
          <Skeleton strong className="h-3 w-[60%]" />
          <Skeleton className="h-2.5 w-[70%]" />
          <Skeleton className="mt-auto h-4.5 w-1/2 rounded-full" />
          <Shimmer />
        </div>
      ))}
    </div>
  );
}
