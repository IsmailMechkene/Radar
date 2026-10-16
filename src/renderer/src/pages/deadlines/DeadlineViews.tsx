import {
  AlarmClock,
  Bell,
  BellOff,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Ellipsis,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import type { DeadlineEvent } from '../../../../shared/ipc';
import { Badge } from '../../../components/Badge';
import { OrgAvatar } from '../../../components/Brand';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Menu, Popover, type MenuItemDef } from '../../../components/Popover';
import { cn } from '../../../components/lib/cn';
import { formatLongDate } from '../../lib/dates';
import {
  groupEvents,
  leftChip,
  monthCells,
  monthTitle,
  urgency,
  type DueItem,
  type Urgency,
} from '../../lib/deadlines';
import { monogram, monogramHue } from '../../lib/opportunities';

const who = (e: DeadlineEvent) => e.org ?? e.title;
const label = (e: DeadlineEvent) => (e.event === 'opens' ? `${e.title}: window opens` : e.title);
/** "Acme · ML Intern"; no prefix when the title already names the organization. */
const withOrg = (e: DeadlineEvent) =>
  e.org && !e.title.toLowerCase().startsWith(e.org.toLowerCase())
    ? `${e.org} · ${label(e)}`
    : label(e);

function Avatar({ name }: { name: string }) {
  return <OrgAvatar initials={monogram(name)} hue={monogramHue(name)} size="xs" />;
}

export function StatusBadge({ e }: { e: DeadlineEvent }) {
  return e.status === 'confirmed' ? (
    <Badge tone="green" strong size="sm" icon={CircleCheck}>
      Confirmed
    </Badge>
  ) : (
    <Badge tone="expected" strong size="sm" icon={CircleDashed}>
      Expected, unconfirmed
    </Badge>
  );
}

function Left({ e, now, tz }: { e: DeadlineEvent; now: Date; tz: string }) {
  const c = leftChip(e, now, tz);
  return (
    <Badge tone={c.tone} dashed={c.dashed}>
      {c.label}
    </Badge>
  );
}

interface RowActions {
  onOpenLink: (url: string) => void;
  onDeleteManual: (id: number, title: string) => void;
}

function RowMenu({ e, actions }: { e: DeadlineEvent; actions: RowActions }) {
  const [open, setOpen] = useState(false);
  const items: MenuItemDef[] = [];
  if (e.url) {
    const url = e.url;
    items.push({
      id: 'open',
      label: e.target_type === 'program' ? 'Open program page' : 'Open link',
      icon: ExternalLink,
      onSelect: () => {
        setOpen(false);
        actions.onOpenLink(url);
      },
    });
  }
  if (e.target_type === 'manual') {
    items.push({
      id: 'delete',
      label: 'Delete deadline',
      icon: Trash2,
      destructive: true,
      separatorBefore: items.length > 0,
      onSelect: () => {
        setOpen(false);
        actions.onDeleteManual(e.target_id, e.title);
      },
    });
  }
  if (items.length === 0) return <span aria-hidden="true" className="size-6" />;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`More for ${e.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring grid size-6 place-items-center rounded-xs text-fg-3 hover:bg-fill hover:text-fg-2"
      >
        <Icon icon={Ellipsis} size={15} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="end">
        <Menu items={items} label="Deadline actions" autoFocus initialActive={0} />
      </Popover>
    </div>
  );
}

const LIST_COLUMNS = '56px 28px minmax(0,1fr) 150px 130px 64px';

export function DeadlineList({
  events,
  now,
  tz,
  actions,
}: {
  events: readonly DeadlineEvent[];
  now: Date;
  tz: string;
  actions: RowActions;
}) {
  const groups = groupEvents(events, now, tz);
  if (groups.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-subhead text-fg-2">No upcoming deadlines.</div>
    );
  }
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(new Date(iso));
  return (
    <div role="list" aria-label="Deadlines">
      {groups.map((g, gi) => (
        <section key={g.id} aria-label={g.label}>
          <div
            className={cn(
              'bg-surface-2 px-4 pt-3.5 pb-1.5 text-caption-2 font-semibold tracking-caps text-fg-3 uppercase',
              gi > 0 && 'hairline-t border-line',
            )}
          >
            {g.label}
          </div>
          {g.items.map((e) => (
            <div
              key={e.key}
              role="listitem"
              aria-label={`${label(e)}, ${formatLongDate(e.at, tz)}`}
              className="grid h-14 items-center gap-x-3 px-4 hairline-t border-line hover:bg-fill"
              style={{ gridTemplateColumns: LIST_COLUMNS }}
            >
              <div className="flex flex-col leading-tight">
                <span className="text-micro font-semibold tracking-header text-red-fill uppercase">
                  {fmt(e.at, { month: 'short' })}
                </span>
                <span className="text-title-3 font-semibold tracking-title-2 tabular-nums">
                  {fmt(e.at, { day: 'numeric' })}
                </span>
              </div>
              <Avatar name={who(e)} />
              <div className="min-w-0">
                <div className="truncate text-body font-semibold">{label(e)}</div>
                <div className="truncate text-footnote text-fg-2">
                  {e.org && e.org !== e.title ? `${e.org} · ` : ''}
                  {formatLongDate(e.at, tz)}
                </div>
              </div>
              <StatusBadge e={e} />
              <Left e={e} now={now} tz={tz} />
              <div className="flex items-center justify-end gap-1 text-fg-3">
                <span
                  title={
                    e.done
                      ? 'Done: no more reminders'
                      : e.tracked
                        ? 'Reminders on'
                        : 'No reminders (star it or add it to the pipeline)'
                  }
                  aria-label={e.done ? 'Done' : e.tracked ? 'Reminders on' : 'No reminders'}
                  role="img"
                  className={cn(e.tracked && !e.done && 'text-accent-text')}
                >
                  <Icon icon={e.done ? Check : e.tracked ? Bell : BellOff} size={15} />
                </span>
                <RowMenu e={e} actions={actions} />
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

const DOT: Record<Urgency, { fill: string; border: string }> = {
  overdue: { fill: 'bg-red-fill', border: 'border-red-fill' },
  week: { fill: 'bg-amber-fill', border: 'border-amber-fill' },
  later: { fill: 'bg-accent', border: 'border-accent' },
};

function EventDot({ e, now, tz }: { e: DeadlineEvent; now: Date; tz: string }) {
  const u = DOT[urgency(e, now, tz)];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.75 shrink-0 rounded-full',
        e.status === 'confirmed' ? u.fill : cn('border-[1.5px] border-dashed', u.border),
      )}
    />
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PER_DAY = 3;

export function MonthView({
  year,
  month,
  events,
  now,
  tz,
  onMove,
  onToday,
}: {
  year: number;
  month: number;
  events: readonly DeadlineEvent[];
  now: Date;
  tz: string;
  onMove: (delta: number) => void;
  onToday: () => void;
}) {
  const cells = monthCells(year, month, events, now, tz);
  return (
    <div>
      <div className="flex h-13 items-center gap-2.5 px-4">
        <h2 className="m-0 text-title-3 font-semibold tracking-title-3">
          {monthTitle(year, month)}
        </h2>
        <div className="flex gap-0.5 text-fg-2">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMove(-1)}
            className="focus-ring grid size-6 place-items-center rounded-xs hover:bg-fill"
          >
            <Icon icon={ChevronLeft} size={16} />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMove(1)}
            className="focus-ring grid size-6 place-items-center rounded-xs hover:bg-fill"
          >
            <Icon icon={ChevronRight} size={16} />
          </button>
        </div>
        <Button size="sm" onClick={onToday}>
          Today
        </Button>
        <div className="ml-auto flex items-center gap-3.5 text-caption text-fg-2">
          <span className="flex items-center gap-1.25">
            <span className="size-2 rounded-full bg-fg-2" />
            Confirmed
          </span>
          <span className="flex items-center gap-1.25">
            <span className="size-2 rounded-full border-[1.5px] border-dashed border-fg-2" />
            Expected
          </span>
          <span className="h-3 w-px bg-line-2" />
          <span className="flex items-center gap-1.25">
            <span className="size-2 rounded-full bg-red-fill" />
            Overdue
          </span>
          <span className="flex items-center gap-1.25">
            <span className="size-2 rounded-full bg-amber-fill" />
            Within 7 days
          </span>
          <span className="flex items-center gap-1.25">
            <span className="size-2 rounded-full bg-accent" />
            Later
          </span>
        </div>
      </div>
      <div
        role="grid"
        aria-label={monthTitle(year, month)}
        className="grid grid-cols-7 hairline-t border-line"
      >
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            role="columnheader"
            className="flex h-7 items-center px-2.5 text-caption-2 font-semibold tracking-header text-fg-3 uppercase"
          >
            {d}
          </div>
        ))}
        {cells.map((c, i) => (
          <div
            key={c.date}
            role="gridcell"
            aria-label={`${c.date}${c.events.length ? `, ${c.events.length} deadline${c.events.length > 1 ? 's' : ''}` : ''}`}
            className={cn(
              'flex h-21.5 min-w-0 flex-col gap-0.75 overflow-hidden px-1.5 pt-1.5 hairline-t border-line',
              i % 7 > 0 && 'hairline-l',
              !c.inMonth && 'bg-surface-2',
            )}
          >
            <div className="flex">
              <span
                className={cn(
                  'grid h-5.5 min-w-5.5 place-items-center rounded-full px-1.25 text-footnote tabular-nums',
                  c.today
                    ? 'bg-accent font-semibold text-on-accent'
                    : c.inMonth
                      ? 'text-fg'
                      : 'text-fg-3',
                )}
              >
                {c.day}
              </span>
            </div>
            {c.events.slice(0, MAX_PER_DAY).map((e) => (
              <div
                key={e.key}
                title={`${label(e)} · ${e.status === 'expected' ? 'expected, unconfirmed' : 'confirmed'}`}
                className="flex h-4.75 min-w-0 items-center gap-1.25 rounded-2xs bg-fill px-1.5 text-caption-2 font-medium"
              >
                <EventDot e={e} now={now} tz={tz} />
                <span className="truncate">{withOrg(e)}</span>
              </div>
            ))}
            {c.events.length > MAX_PER_DAY && (
              <div className="px-1.5 text-caption-2 text-fg-3">
                +{c.events.length - MAX_PER_DAY} more
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DueSoon({
  items,
  now,
  tz,
  onSnooze,
  onDone,
}: {
  items: readonly DueItem[];
  now: Date;
  tz: string;
  onSnooze: (item: DueItem) => void;
  onDone: (item: DueItem) => void;
}) {
  return (
    <aside aria-label="Due soon" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 text-caption-2 font-semibold tracking-caps text-fg-3 uppercase">
          Due soon
        </h2>
        <div className="text-footnote text-fg-3">Next 14 days</div>
      </div>
      {items.length === 0 && (
        <div className="rounded-2xl bg-surface px-3.5 py-4 text-subhead text-fg-2 hairline border-line shadow-card">
          Nothing due in the next 14 days. Starred and pipeline deadlines, watched programs, manual
          deadlines and follow-ups show up here.
        </div>
      )}
      {items.map((item) => {
        const title =
          item.kind === 'followup' ? `Follow up with ${item.followup.org}` : label(item.event);
        const sub =
          item.kind === 'followup'
            ? (item.followup.role ?? 'Still waiting for an answer')
            : (item.event.org ?? '');
        const name = item.kind === 'followup' ? item.followup.org : who(item.event);
        const chip =
          item.kind === 'followup'
            ? { label: 'Follow-up due', tone: 'amber' as const, dashed: false }
            : leftChip(item.event, now, tz);
        return (
          <div
            key={item.key}
            className="rounded-2xl bg-surface pt-3 pr-3 pb-2.5 pl-3.5 hairline border-line shadow-card"
          >
            <div className="flex items-start gap-2.5">
              <Avatar name={name} />
              <div className="min-w-0 flex-1">
                <div className="text-body leading-snug font-semibold">{title}</div>
                {sub && <div className="truncate text-footnote text-fg-2">{sub}</div>}
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5">
              <Badge tone={chip.tone} strong dashed={chip.dashed}>
                {chip.label}
              </Badge>
              <span className="truncate text-caption text-fg-3 tabular-nums">
                {new Intl.DateTimeFormat('en-US', {
                  timeZone: tz,
                  month: 'short',
                  day: 'numeric',
                }).format(new Date(item.at))}
              </span>
              <button
                type="button"
                onClick={() => onSnooze(item)}
                aria-label={`Snooze ${title} for 1 day`}
                className="focus-ring ml-auto flex h-6 items-center gap-1 rounded-xs px-1.5 text-footnote text-fg-2 hover:bg-fill"
              >
                <Icon icon={AlarmClock} size={13} />
                Snooze
              </button>
              <button
                type="button"
                onClick={() => onDone(item)}
                aria-label={`Mark ${title} done`}
                className="focus-ring flex h-6 items-center gap-1 rounded-xs px-2 text-footnote font-medium text-accent-text hover:bg-accent-soft"
              >
                <Icon icon={Check} size={13} stroke={2} />
                Done
              </button>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
