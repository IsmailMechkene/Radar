import { ArrowDownUp, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { OptionMenu } from '../../../components/OptionMenu';
import { Popover } from '../../../components/Popover';
import { useToastLift } from '../../../components/Toast';
import { formatWeekday } from '../../lib/dates';
import {
  applyFilters,
  describeEmpty,
  isNew,
  newSinceFor,
  NO_FILTERS,
  sortItems,
  SORTS,
  viewCounts,
  type Ctx,
  type Filters,
  type SortId,
  type ViewId,
} from '../../lib/opportunities';
import { useScan } from '../../state/scan';
import { useSettings } from '../../state/settings';
import { PageTitle } from '../PageTitle';
import { BulkBar } from './BulkBar';
import { FilterBar, ViewTabs } from './FilterBar';
import { NewStrip, NewStripSkeleton } from './NewStrip';
import { OpportunityDrawer } from './OpportunityDrawer';
import { OpportunityTable, TableEmpty, TableSkeleton } from './OpportunityTable';
import { useOpportunities } from './useOpportunities';

/** Design breakpoint: below 1200 px the table drops Remote/Source/Posted and the strip shows 3. */
const WIDE_MIN = 1200;

function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

// The "last visit" marker is read once per app session, then advanced to now; the strip keeps
// showing what was new when the session started.
let sessionNewSince: { lastVisit: string | null; since: string } | null = null;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

interface Props {
  query: string;
  isPackaged: boolean;
}

export function OpportunitiesPage({ query, isPackaged }: Props) {
  const { settings, update } = useSettings();
  const api = useOpportunities();
  const scan = useScan();

  // A finished scan (Scan now, Ctrl+R) brings new rows: reload the list.
  const { reload } = api;
  useEffect(() => {
    if (scan.version > 0) void reload();
  }, [scan.version, reload]);
  const width = useWindowWidth();
  const wide = width >= WIDE_MIN;

  const [view, setView] = useState<ViewId>('all');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<SortId>('score');
  const [sortOpen, setSortOpen] = useState(false);
  const [rawChecked, setChecked] = useState<Set<number>>(new Set());
  const [cursorId, setCursorId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [confirmIds, setConfirmIds] = useState<number[] | null>(null);
  const [now] = useState(() => new Date());
  const rows = useRef(new Map<number, HTMLDivElement>());

  // "New since your last visit": the previous visit is captured once per session (before the
  // marker is advanced below), so the strip keeps showing what was new when the session began.
  const seenAt = settings ? settings.opportunitiesSeenAt : undefined;
  const visit = useMemo(
    () =>
      sessionNewSince ??
      (seenAt === undefined ? null : { lastVisit: seenAt, since: newSinceFor(seenAt, now) }),
    [seenAt, now],
  );
  useEffect(() => {
    if (!visit || sessionNewSince) return;
    sessionNewSince = visit;
    void update('opportunitiesSeenAt', now.toISOString(), { toast: false });
  }, [visit, update, now]);

  // Descriptions are not in the list (they were most of its size): the main process searches
  // them and answers with ids. Debounced; asked again when the list reloads.
  const [search, setSearch] = useState<{ query: string; ids: ReadonlySet<number> } | null>(null);
  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) return;
    const timer = setTimeout(() => {
      window.radar.opportunities.search(trimmed).then(
        (ids) => setSearch({ query: trimmed, ids: new Set(ids) }),
        (err: unknown) => console.error('[opportunities] search failed; matching titles only', err),
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [trimmed, api.items]);
  const searchIds = search && search.query === trimmed ? search.ids : null;

  const ctx: Ctx = useMemo(
    () => ({
      now,
      timeZone: settings?.timezone ?? 'UTC',
      newSince: visit?.since ?? newSinceFor(null, now),
      searchIds,
    }),
    [now, settings?.timezone, visit, searchIds],
  );

  const items = useMemo(() => api.items ?? [], [api.items]);
  const visible = useMemo(
    () => sortItems(applyFilters(items, view, filters, query, ctx), sort),
    [items, view, filters, query, ctx, sort],
  );
  const counts = useMemo(
    () => viewCounts(items, filters, query, ctx),
    [items, filters, query, ctx],
  );
  const newItems = useMemo(
    () =>
      sortItems(
        items.filter((i) => isNew(i, ctx)),
        'score',
      ),
    [items, ctx],
  );

  // Only ids that still exist count as selected (dismissed elsewhere, sample cleared).
  const checked = useMemo(() => {
    const ids = new Set(items.map((i) => i.id));
    return new Set([...rawChecked].filter((id) => ids.has(id)));
  }, [rawChecked, items]);

  useToastLift(checked.size > 0);

  const byId = useCallback((id: number | null) => items.find((i) => i.id === id), [items]);

  const open = useCallback((id: number) => {
    setOpenId(id);
    setCursorId(id);
  }, []);

  const toggleCheck = useCallback((id: number) => {
    setChecked((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const starIds = useCallback(
    (ids: number[]) => {
      const all = ids.every((id) => byId(id)?.starred);
      void api.setStarred(ids, !all);
    },
    [api, byId],
  );

  const dismissIds = useCallback(
    (ids: number[]) => {
      if (openId !== null && ids.includes(openId)) setOpenId(null);
      setChecked(new Set());
      void api.dismiss(ids);
    },
    [api, openId],
  );

  const moveCursor = useCallback(
    (delta: number) => {
      if (!visible.length) return;
      const i = visible.findIndex((x) => x.id === cursorId);
      const next = visible[Math.max(0, Math.min(visible.length - 1, i < 0 ? 0 : i + delta))]!;
      setCursorId(next.id);
      if (openId !== null) setOpenId(next.id);
      rows.current.get(next.id)?.scrollIntoView({ block: 'nearest' });
    },
    [visible, cursorId, openId],
  );

  // Keyboard: j/k move, Enter opens, s stars, x dismisses, Space selects, Esc closes/clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (confirmIds) return;
      const target = checked.size ? [...checked] : cursorId !== null ? [cursorId] : [];
      switch (e.key) {
        case 'j':
          moveCursor(1);
          break;
        case 'k':
          moveCursor(-1);
          break;
        case 'Enter':
          if (cursorId !== null && !(e.target instanceof HTMLButtonElement)) open(cursorId);
          else return;
          break;
        case 's':
          if (!target.length) return;
          starIds(target);
          break;
        case 'x':
          if (!target.length) return;
          if (checked.size > 1) setConfirmIds(target);
          else dismissIds(target);
          break;
        case ' ':
          if (cursorId === null || e.target instanceof HTMLButtonElement) return;
          toggleCheck(cursorId);
          break;
        case 'Escape':
          if (openId !== null) return; // the drawer handles its own Escape
          if (!checked.size) return;
          setChecked(new Set());
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checked, cursorId, openId, confirmIds, moveCursor, open, starIds, dismissIds, toggleCheck]);

  const loading = api.items === null && !api.error;
  const hasSample = items.some((i) => i.source_kind === 'sample');
  const sortLabel = SORTS.find((s) => s.id === sort)!.label;
  const stripCols = wide ? 5 : 3;
  const visitWeekday = visit?.lastVisit ? formatWeekday(visit.lastVisit, ctx.timeZone) : null;

  const subtitle = loading
    ? 'Loading…'
    : [
        `${items.length} open`,
        newItems.length
          ? `${newItems.length} new${visitWeekday ? ` since ${visitWeekday}` : ''}`
          : null,
        `sorted by ${sortLabel.toLowerCase()}`,
      ]
        .filter(Boolean)
        .join(' · ');

  const empty =
    items.length === 0 ? (
      <TableEmpty
        title="No opportunities yet"
        message={
          scan.view.canScan
            ? 'Run a scan to fetch postings from your sources.'
            : 'Radar lists results here once sources are added and scanned.'
        }
        actions={
          <>
            {scan.view.canScan && (
              <Button variant="primary" onClick={scan.scanNow}>
                Scan now
              </Button>
            )}
            {!isPackaged && <Button onClick={() => void api.loadSample()}>Load sample data</Button>}
          </>
        }
      />
    ) : (
      <TableEmpty
        title="Nothing matches these filters"
        message={`${describeEmpty(view, filters, query)} Widen the deadline window or lower the score floor.`}
        actions={
          <>
            <Button
              onClick={() => {
                setFilters(NO_FILTERS);
                setView('all');
              }}
            >
              Clear filters
            </Button>
            {(filters.deadline === '7' || filters.deadline === '14') && (
              <Button variant="primary" onClick={() => setFilters({ ...filters, deadline: '30' })}>
                Widen to 30 days
              </Button>
            )}
          </>
        }
      />
    );

  return (
    <div>
      <div className="mb-5.5 flex items-end justify-between gap-4">
        <PageTitle title="Opportunities" subtitle={subtitle} />
        <div className="flex gap-2">
          <div className="relative">
            <Button
              icon={ArrowDownUp}
              aria-haspopup="menu"
              aria-expanded={sortOpen}
              aria-label={`Sort by ${sortLabel}`}
              onClick={() => setSortOpen(!sortOpen)}
            >
              {sortLabel}
            </Button>
            <Popover open={sortOpen} onClose={() => setSortOpen(false)} align="end">
              <OptionMenu
                label="Sort by"
                options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
                selected={[sort]}
                onPick={(v) => {
                  setSort(v);
                  setSortOpen(false);
                }}
              />
            </Popover>
          </div>
        </div>
      </div>

      {!isPackaged && hasSample && (
        <div className="-mt-3 mb-4 flex items-center gap-2 text-footnote text-fg-3">
          Showing development sample data, not real postings.
          <button
            type="button"
            onClick={() => void api.clearSample()}
            className="focus-ring rounded-xs font-medium text-accent-text"
          >
            Remove sample data
          </button>
        </div>
      )}

      {api.error ? (
        <Banner
          title="Opportunities could not be loaded."
          description={api.error}
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void api.reload()}>
              Retry
            </Button>
          }
        />
      ) : loading ? (
        <>
          <NewStripSkeleton columns={stripCols} />
          <TableSkeleton wide={wide} />
        </>
      ) : (
        <>
          {newItems.length > 0 && view === 'all' && !filters.newOnly && !query && (
            <NewStrip
              items={newItems.slice(0, stripCols)}
              total={newItems.length}
              ctx={ctx}
              columns={stripCols}
              lastVisit={visit?.lastVisit ?? null}
              onOpen={open}
              onSeeAll={() => setFilters({ ...filters, newOnly: true })}
            />
          )}
          {items.length > 0 && (
            <>
              <ViewTabs view={view} counts={counts} onChange={setView} />
              <FilterBar
                items={items}
                view={view}
                filters={filters}
                query={query}
                ctx={ctx}
                resultCount={visible.length}
                onChange={setFilters}
              />
            </>
          )}
          <OpportunityTable
            items={visible}
            ctx={ctx}
            wide={wide}
            checked={checked}
            openId={openId}
            cursorId={cursorId}
            rowRef={(id, el) => {
              if (el) rows.current.set(id, el);
              else rows.current.delete(id);
            }}
            onOpen={open}
            onCheck={toggleCheck}
            onStar={(item) => void api.setStarred([item.id], !item.starred)}
            onCursor={setCursorId}
            empty={empty}
          />
        </>
      )}

      <OpportunityDrawer
        id={openId}
        starred={byId(openId)?.starred ?? false}
        ctx={ctx}
        wide={wide}
        api={api}
        onClose={() => setOpenId(null)}
        onStar={() => openId !== null && starIds([openId])}
        onDismiss={() => openId !== null && dismissIds([openId])}
      />

      <BulkBar
        count={checked.size}
        allStarred={[...checked].every((id) => byId(id)?.starred)}
        onStar={() => starIds([...checked])}
        onDismiss={() => setConfirmIds([...checked])}
        onPipeline={() => {
          void api.addToPipeline([...checked]);
          setChecked(new Set());
        }}
        onClear={() => setChecked(new Set())}
      />

      <ConfirmDialog
        open={confirmIds !== null}
        title={
          confirmIds?.length === 1
            ? 'Dismiss 1 opportunity?'
            : `Dismiss ${confirmIds?.length ?? 0} opportunities?`
        }
        message="They disappear from every view. You can undo right after from the notification."
        confirmLabel="Dismiss"
        onCancel={() => setConfirmIds(null)}
        onConfirm={() => {
          if (confirmIds) dismissIds(confirmIds);
          setConfirmIds(null);
        }}
      />
    </div>
  );
}
