import { BellRing, Check, ChevronsUpDown, Clock, Minus } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { PipelineItem, PipelineStatus } from '../../../../shared/ipc';
import { OrgAvatar } from '../../../components/Brand';
import { Icon } from '../../../components/Icon';
import { Popover } from '../../../components/Popover';
import { Shimmer, Skeleton } from '../../../components/Skeleton';
import { TableRow } from '../../../components/TableRow';
import { cn } from '../../../components/lib/cn';
import { formatShortDate } from '../../lib/dates';
import { monogram, monogramHue } from '../../lib/opportunities';
import {
  followupChips,
  formatLocalDate,
  PIPELINE_STATUSES,
  roleOf,
  STATUS_META,
  statusCounts,
  type FollowupChip,
} from '../../lib/pipeline';

/** Design column template (pCols); below 1200 px the Notes column drops. */
export const PIPELINE_COLUMNS = {
  wide: 'minmax(0,1.3fr) 148px 56px 52px 200px minmax(0,0.85fr) minmax(0,1fr)',
  narrow: 'minmax(0,1.3fr) 148px 56px 52px 200px minmax(0,0.85fr)',
} as const;

function Dot({ status }: { status: PipelineStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-1.75 shrink-0 rounded-full', STATUS_META[status].dot)}
    />
  );
}

/** Eight status totals in one card, as in the design. */
export function StatusStrip({ items }: { items: readonly PipelineItem[] }) {
  const counts = statusCounts(items);
  return (
    <div
      role="list"
      aria-label="Entries by status"
      className="mb-4 grid grid-cols-8 overflow-hidden rounded-2xl bg-surface hairline border-line shadow-card"
    >
      {PIPELINE_STATUSES.map((s, i) => (
        <div
          key={s}
          role="listitem"
          className={cn('px-3.5 py-3', i > 0 && 'hairline-l border-line')}
        >
          <div className="flex items-center gap-1.5 text-caption whitespace-nowrap text-fg-2">
            <Dot status={s} />
            {STATUS_META[s].label}
          </div>
          <div
            className={cn(
              'mt-0.5 text-title-2 font-semibold tracking-title-2 tabular-nums',
              counts[s] ? 'text-fg' : 'text-fg-3',
            )}
          >
            {counts[s]}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Status pop-up button with the eight statuses (check column + colored dot). */
export function StatusPicker({
  item,
  onPick,
}: {
  item: PipelineItem;
  onPick: (status: PipelineStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  function show() {
    setActive(Math.max(0, PIPELINE_STATUSES.indexOf(item.status)));
    setOpen(true);
  }
  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }
  function pick(s: PipelineStatus) {
    close();
    if (s !== item.status) onPick(s);
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + d + PIPELINE_STATUSES.length) % PIPELINE_STATUSES.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(PIPELINE_STATUSES[active]!);
    } else if (e.key === 'Tab') close();
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status of ${item.org}: ${STATUS_META[item.status].label}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            show();
          }
        }}
        className={cn(
          'focus-ring inline-flex h-6.5 items-center gap-1.5 rounded-sm pr-2 pl-2.5 whitespace-nowrap',
          'bg-surface hairline border-line-2 text-subhead font-medium shadow-control',
        )}
      >
        <Dot status={item.status} />
        {STATUS_META[item.status].label}
        <Icon icon={ChevronsUpDown} size={12} className="text-fg-3" />
      </button>
      <Popover open={open} onClose={close} className="w-50">
        <div
          ref={listRef}
          role="menu"
          aria-label="Status"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="outline-none"
        >
          {PIPELINE_STATUSES.map((s, i) => (
            <div
              key={s}
              role="menuitemradio"
              aria-checked={s === item.status}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              className={cn(
                'flex h-7 items-center gap-2 rounded-xs px-2 text-body',
                i === active ? 'bg-accent text-on-accent' : 'text-fg',
              )}
            >
              <span className="inline-flex w-3.5">
                {s === item.status && <Icon icon={Check} size={13} stroke={2} />}
              </span>
              <Dot status={s} />
              {STATUS_META[s].label}
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}

const CHIP_STYLE: Record<FollowupChip['tone'], string> = {
  done: 'text-fg-3 hairline border-line-2 font-medium',
  due: 'bg-amber-soft text-amber font-semibold',
  upcoming: 'bg-fill text-fg-2 font-medium',
  none: 'text-fg-3',
};
const CHIP_ICON = { done: Check, due: BellRing, upcoming: Clock, none: Minus } as const;

export function FollowupChips({ chips }: { chips: readonly FollowupChip[] }) {
  return (
    <div className="flex gap-1.5">
      {chips.map((c) => (
        <span
          key={c.label}
          className={cn(
            'inline-flex h-5.5 items-center gap-1 rounded-full px-2 text-caption whitespace-nowrap tabular-nums',
            CHIP_STYLE[c.tone],
          )}
        >
          <Icon icon={CHIP_ICON[c.tone]} size={11} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

function Header({ wide }: { wide: boolean }) {
  const labels = ['Organization', 'Status', 'Planned', 'Sent', 'Follow-ups', 'Contact'];
  return (
    <div
      role="row"
      className="grid h-8.5 items-center gap-x-3.5 px-4 text-caption-2 font-semibold tracking-header text-fg-3 uppercase"
      style={{ gridTemplateColumns: wide ? PIPELINE_COLUMNS.wide : PIPELINE_COLUMNS.narrow }}
    >
      {[...labels, ...(wide ? ['Notes'] : [])].map((l) => (
        <span key={l} role="columnheader" className="whitespace-nowrap">
          {l}
        </span>
      ))}
    </div>
  );
}

interface TableProps {
  items: readonly PipelineItem[];
  wide: boolean;
  now: Date;
  timeZone: string;
  openId: number | null;
  onOpen: (id: number) => void;
  onStatus: (item: PipelineItem, status: PipelineStatus) => void;
}

export function PipelineTable({
  items,
  wide,
  now,
  timeZone,
  openId,
  onOpen,
  onStatus,
}: TableProps) {
  return (
    <div
      role="table"
      aria-label="Pipeline"
      aria-rowcount={items.length}
      // No overflow clipping (status menus open below rows); the last row keeps the corners.
      className="rounded-2xl bg-surface hairline border-line shadow-card [&>[role=row]:last-child]:rounded-b-2xl"
    >
      <Header wide={wide} />
      {items.map((item) => {
        const role = roleOf(item);
        return (
          <TableRow
            key={item.id}
            inset="sm"
            className="gap-x-3.5"
            columns={wide ? PIPELINE_COLUMNS.wide : PIPELINE_COLUMNS.narrow}
            selected={openId === item.id}
            tabIndex={0}
            aria-label={`${item.org}${role ? `, ${role}` : ''}`}
            onClick={() => onOpen(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(item.id);
            }}
          >
            <div role="cell" className="flex min-w-0 items-center gap-2.5">
              <OrgAvatar initials={monogram(item.org)} hue={monogramHue(item.org)} size="xs" />
              <div className="min-w-0">
                <div className="truncate text-body font-semibold">{item.org}</div>
                <div className="truncate text-footnote text-fg-2">{role || '—'}</div>
              </div>
            </div>
            <div role="cell">
              <StatusPicker item={item} onPick={(s) => onStatus(item, s)} />
            </div>
            <div role="cell" className="text-subhead text-fg-2 tabular-nums">
              {item.planned_send_date ? formatLocalDate(item.planned_send_date) : '—'}
            </div>
            <div role="cell" className="text-subhead text-fg-2 tabular-nums">
              {item.sent_at ? formatShortDate(item.sent_at, timeZone) : '—'}
            </div>
            <div role="cell">
              <FollowupChips chips={followupChips(item, now, timeZone)} />
            </div>
            <div role="cell" className="min-w-0">
              <div className="truncate text-subhead">{item.contact_name ?? '—'}</div>
              {item.contact_url && (
                <div className="truncate text-caption text-fg-3">{item.contact_url}</div>
              )}
            </div>
            {wide && (
              <div role="cell" className="truncate text-subhead text-fg-2" title={item.notes ?? ''}>
                {item.notes ?? ''}
              </div>
            )}
          </TableRow>
        );
      })}
    </div>
  );
}

export function PipelineSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-surface hairline border-line shadow-card">
      <Shimmer />
      <div className="h-8.5" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-3 px-4 hairline-t border-line">
          <Skeleton className="size-7" strong />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-40" strong />
            <Skeleton className="h-2.5 w-56" />
          </div>
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}
