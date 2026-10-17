import { Radar, Star } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import type { OpportunityListItem } from '../../../../shared/ipc';
import { Badge, VerdictBadge } from '../../../components/Badge';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { MetaChip } from '../../../components/Pill';
import { ScoreRing } from '../../../components/ScoreRing';
import { Shimmer, Skeleton } from '../../../components/Skeleton';
import { RowTitle, TableRow } from '../../../components/TableRow';
import { cn } from '../../../components/lib/cn';
import { shortAge } from '../../lib/dates';
import { deadlineChip, REMOTE_LABELS, type Ctx, type DeadlineTone } from '../../lib/opportunities';
import { REMOTE_ICONS, sourceIcon } from './icons';

type Item = OpportunityListItem;

/** Design column templates: wide (window >= 1200 px) shows Remote, Source and Posted. */
export const COLUMNS = {
  wide: '16px 32px minmax(0,1fr) 112px 84px 150px 50px 112px 100px 18px',
  narrow: '16px 32px minmax(0,1fr) 104px 104px 96px 18px',
} as const;

const CHIP_TONE: Record<DeadlineTone, 'red' | 'amber' | 'neutral' | 'outline'> = {
  red: 'red',
  amber: 'amber',
  neutral: 'neutral',
  none: 'outline',
};

function Header({ wide }: { wide: boolean }) {
  // aria-rowindex 1: rows below are numbered from 2 even when only some are rendered.
  // Labels may overflow their column ("SCORE" is wider than the 32 px ring), as in the design.
  const cell = (label: string) => (
    <span role="columnheader" className="whitespace-nowrap">
      {label}
    </span>
  );
  return (
    <div
      role="row"
      aria-rowindex={1}
      className="grid h-8.5 items-center gap-x-3 px-4 text-caption-2 font-semibold tracking-header text-fg-3 uppercase"
      style={{ gridTemplateColumns: wide ? COLUMNS.wide : COLUMNS.narrow }}
    >
      <span role="columnheader" aria-label="Selected" />
      {cell('Score')}
      {cell('Role')}
      {cell('Location')}
      {wide && (
        <>
          {cell('Remote')}
          {cell('Source')}
          {cell('Posted')}
        </>
      )}
      {cell('Deadline')}
      {cell('Verdict')}
      <span role="columnheader" aria-label="Starred" />
    </div>
  );
}

interface RowProps {
  item: Item;
  ctx: Ctx;
  wide: boolean;
  checked: boolean;
  open: boolean;
  cursor: boolean;
  /** 1-based position in the table (header = 1), for screen readers in a windowed list. */
  rowIndex: number;
  onOpen: (id: number) => void;
  onCheck: (id: number) => void;
  onStar: (item: Item) => void;
  onCursor: (id: number) => void;
}

// Memoized with callbacks that take the id: opening, checking or moving the cursor re-renders
// only the rows whose state changed, not the whole list (which made the drawer stutter).
const Row = memo(function Row({
  item,
  ctx,
  wide,
  checked,
  open,
  cursor,
  rowIndex,
  onOpen: openId,
  onCheck: checkId,
  onStar: star,
  onCursor,
}: RowProps) {
  const onOpen = () => openId(item.id);
  const onCheck = () => checkId(item.id);
  const onStar = () => star(item);
  const onFocusRow = () => onCursor(item.id);
  const chip = deadlineChip(item, ctx);
  const SourceIcon = sourceIcon(item.source_access_method, item.opportunity_type);
  return (
    <TableRow
      aria-rowindex={rowIndex}
      inset="sm"
      columns={wide ? COLUMNS.wide : COLUMNS.narrow}
      selected={checked || open}
      hovered={cursor}
      tabIndex={cursor ? 0 : -1}
      aria-label={`${item.title}, ${item.org}`}
      onClick={onOpen}
      onFocus={onFocusRow}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
      }}
    >
      <div role="cell" onClick={(e) => e.stopPropagation()}>
        <Checkbox label={`Select ${item.title}`} checked={checked} onChange={onCheck} />
      </div>
      <div role="cell">
        <ScoreRing score={item.score} />
      </div>
      <RowTitle title={item.title} lead={item.org} detail={item.summary ?? ''} />
      <div role="cell" className="truncate text-subhead text-fg-2">
        {item.location ?? '—'}
      </div>
      {wide && (
        <>
          <div role="cell">
            <MetaChip
              label={REMOTE_LABELS[item.remote_type]}
              icon={REMOTE_ICONS[item.remote_type]}
            />
          </div>
          <div role="cell" className="flex min-w-0 items-center gap-1.5 text-subhead text-fg-2">
            <Icon icon={SourceIcon} size={13} className="shrink-0 text-fg-3" />
            <span className="truncate">{item.source_name}</span>
            {item.source_count > 1 && (
              <span className="shrink-0 text-caption-2 text-fg-3">+{item.source_count - 1}</span>
            )}
          </div>
          <div role="cell" className="text-subhead text-fg-2 tabular-nums">
            {shortAge(item.posted_at ?? item.first_seen_at, ctx.now)}
          </div>
        </>
      )}
      <div role="cell" title={chip.long}>
        <Badge tone={CHIP_TONE[chip.tone]} dashed={chip.expected}>
          {chip.short}
        </Badge>
      </div>
      <div role="cell">
        <VerdictBadge verdict={item.verdict} />
      </div>
      <div role="cell" className="grid place-items-center">
        <button
          type="button"
          aria-label={item.starred ? `Unstar ${item.title}` : `Star ${item.title}`}
          aria-pressed={item.starred}
          onClick={(e) => {
            e.stopPropagation();
            onStar();
          }}
          className={cn(
            'focus-ring grid size-5 place-items-center rounded-xs',
            item.starred ? 'text-amber-fill' : 'text-fg-3 hover:text-fg-2',
          )}
        >
          <Icon icon={Star} size={15} fill={item.starred ? 'currentColor' : 'none'} />
        </button>
      </div>
    </TableRow>
  );
});

interface TableProps {
  items: Item[];
  ctx: Ctx;
  wide: boolean;
  checked: ReadonlySet<number>;
  openId: number | null;
  cursorId: number | null;
  /** Windowing (useWindowedRows): only rows [start, end) are rendered. */
  rows: {
    attach: (el: HTMLDivElement | null) => void;
    start: number;
    end: number;
    paddingTop: number;
    paddingBottom: number;
  };
  /** These must be stable (useCallback) or every row re-renders. */
  onOpen: (id: number) => void;
  onCheck: (id: number) => void;
  onStar: (item: Item) => void;
  onCursor: (id: number) => void;
  /** Rendered inside the card when there are no rows. */
  empty?: ReactNode;
}

/**
 * The results table: 34 px header, 56 px rows in a radius-14 card. Windowed: only the rows near
 * the viewport are in the DOM, padding of the exact height stands in for the others.
 */
export function OpportunityTable(p: TableProps) {
  const { attach, start, end, paddingTop, paddingBottom } = p.rows;
  return (
    <div
      role="table"
      aria-label="Opportunities"
      aria-rowcount={p.items.length + 1}
      className="overflow-hidden rounded-2xl bg-surface hairline border-line shadow-card"
    >
      <Header wide={p.wide} />
      <div ref={attach} role="rowgroup" style={{ paddingTop, paddingBottom }}>
        {p.items.slice(start, end).map((item, k) => (
          <Row
            key={item.id}
            item={item}
            ctx={p.ctx}
            wide={p.wide}
            checked={p.checked.has(item.id)}
            open={p.openId === item.id}
            cursor={p.cursorId === item.id}
            rowIndex={start + k + 2}
            onOpen={p.onOpen}
            onCheck={p.onCheck}
            onStar={p.onStar}
            onCursor={p.onCursor}
          />
        ))}
      </div>
      {p.items.length === 0 && p.empty}
    </div>
  );
}

export function TableSkeleton({ wide }: { wide: boolean }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading opportunities"
      className="overflow-hidden rounded-2xl bg-surface hairline border-line shadow-card"
    >
      <Header wide={wide} />
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="relative grid h-14 items-center gap-x-3 overflow-hidden px-4 hairline-t border-line"
          style={{ gridTemplateColumns: wide ? COLUMNS.wide : COLUMNS.narrow }}
        >
          <Skeleton className="size-4 rounded-2xs" />
          <Skeleton strong className="size-8 rounded-full" />
          <span className="flex flex-col gap-1.5">
            <Skeleton strong className="h-2.75 w-[70%]" />
            <Skeleton className="h-2.25 w-[90%]" />
          </span>
          <Skeleton className="h-2.5 w-[70%]" />
          {wide && (
            <>
              <Skeleton className="h-4.5 w-15 rounded-full" />
              <Skeleton className="h-2.5 w-[80%]" />
              <Skeleton className="h-2.5 w-[60%]" />
            </>
          )}
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <span />
          <Shimmer />
        </div>
      ))}
    </div>
  );
}

/** Empty block inside the table card (design: 56 px icon tile, 17 px title, actions). */
export function TableEmpty({
  title,
  message,
  actions,
}: {
  title: string;
  message: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center hairline-t border-line px-6 pt-18 pb-20 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-3xl bg-fill text-fg-3">
        <Radar size={26} strokeWidth={1.25} aria-hidden="true" />
      </div>
      <div className="text-title-3 font-semibold tracking-title-3">{title}</div>
      <div className="mt-1.5 max-w-95 text-body text-fg-2">{message}</div>
      {actions && <div className="mt-4.5 flex gap-2">{actions}</div>}
    </div>
  );
}
