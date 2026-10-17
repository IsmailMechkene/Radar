import { memo, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { OpportunityListItem } from '../../../../shared/ipc';
import { MenuAction, OptionMenu, type OptionItem } from '../../../components/OptionMenu';
import { FilterPill } from '../../../components/Pill';
import { Popover } from '../../../components/Popover';
import { cn } from '../../../components/lib/cn';
import {
  activeFilterCount,
  applyFilters,
  DEADLINE_WINDOWS,
  matchesDeadline,
  NO_FILTERS,
  REMOTE_LABELS,
  SCORE_FLOORS,
  valueCounts,
  VERDICT_LABELS,
  VIEWS,
  type Ctx,
  type DeadlineWindow,
  type Filters,
  type RemoteType,
  type Verdict,
  type ViewId,
} from '../../lib/opportunities';

type Item = OpportunityListItem;

/** Saved views as a tab bar with counts (design: segmented bar, 26 px tabs). */
export function ViewTabs({
  view,
  counts,
  onChange,
}: {
  view: ViewId;
  counts: Record<ViewId, number>;
  onChange: (v: ViewId) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(e: KeyboardEvent, i: number) {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + VIEWS.length) % VIEWS.length;
    onChange(VIEWS[next]!.id);
    refs.current[next]?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label="Saved views"
      className="mb-3 flex w-max max-w-full items-center gap-0.5 overflow-hidden rounded-lg bg-fill p-0.5 hairline border-line"
    >
      {VIEWS.map((v, i) => {
        const on = v.id === view;
        return (
          <button
            key={v.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(v.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'focus-ring flex h-6.5 items-center gap-1.5 rounded-sm px-3 text-subhead font-medium whitespace-nowrap',
              'transition-[background-color,color] duration-(--duration-base) ease-out',
              on ? 'bg-control text-fg shadow-segment' : 'text-fg-2 hover:text-fg',
            )}
          >
            {v.label}
            <span className="text-caption-2 text-fg-3 tabular-nums">{counts[v.id]}</span>
          </button>
        );
      })}
    </div>
  );
}

type MenuId = 'verdict' | 'score' | 'remote' | 'location' | 'deadline' | 'source';

function toggle<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function summarize(prefix: string, labels: string[]): string {
  if (labels.length === 0) return prefix;
  return labels.length === 1 ? `${prefix}: ${labels[0]}` : `${prefix}: ${labels.length} selected`;
}

interface FilterBarProps {
  items: readonly Item[];
  view: ViewId;
  filters: Filters;
  query: string;
  ctx: Ctx;
  resultCount: number;
  onChange: (f: Filters) => void;
}

/**
 * Filter pills with menus, "Clear all" and the result count. Memoized, and the option counts
 * (each filter's list with the other filters applied) are computed once per change of the inputs:
 * with thousands of postings they cost far more than the rest of the page.
 */
export const FilterBar = memo(function FilterBar({
  items,
  view,
  filters: f,
  query,
  ctx,
  resultCount,
  onChange,
}: FilterBarProps) {
  const [open, setOpen] = useState<MenuId | null>(null);
  const close = () => setOpen(null);
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });

  function pill(
    id: MenuId,
    label: string,
    active: boolean,
    clear: () => void,
    menu: () => ReactNode,
  ) {
    return (
      <div className="relative">
        <FilterPill
          label={label}
          active={active}
          aria-expanded={open === id}
          onClick={() => setOpen(open === id ? null : id)}
          onClear={clear}
        />
        <Popover open={open === id} onClose={close}>
          {menu()}
        </Popover>
      </div>
    );
  }

  const {
    verdictOptions,
    scoreOptions,
    remoteOptions,
    locationOptions,
    deadlineOptions,
    sourceOptions,
  } = useMemo(() => {
    const base = (key: keyof Filters) => applyFilters(items, view, f, query, ctx, key);
    const byVerdict = base('verdicts');
    const byScore = base('minScore');
    const byRemote = base('remote');
    const byDeadline = base('deadline');
    return {
      verdictOptions: (Object.keys(VERDICT_LABELS) as Verdict[]).map((v): OptionItem<Verdict> => ({
        value: v,
        label: VERDICT_LABELS[v],
        count: byVerdict.filter((i) => i.verdict === v).length,
      })),
      scoreOptions: SCORE_FLOORS.map((n): OptionItem<string> => ({
        value: String(n),
        label: `Score ≥ ${n}`,
        count: byScore.filter((i) => (i.score ?? -1) >= n).length,
      })),
      remoteOptions: (Object.keys(REMOTE_LABELS) as RemoteType[]).map(
        (r): OptionItem<RemoteType> => ({
          value: r,
          label: REMOTE_LABELS[r],
          count: byRemote.filter((i) => i.remote_type === r).length,
        }),
      ),
      locationOptions: valueCounts(base('locations').map((i) => i.location)).map(
        ({ value, count }): OptionItem<string> => ({ value, label: value, count }),
      ),
      deadlineOptions: DEADLINE_WINDOWS.map((w): OptionItem<DeadlineWindow> => ({
        value: w.id,
        label: w.label,
        count: byDeadline.filter((i) => matchesDeadline(i, w.id, ctx)).length,
      })),
      sourceOptions: valueCounts(base('sources').map((i) => i.source_name)).map(
        ({ value, count }): OptionItem<string> => ({ value, label: value, count }),
      ),
    };
  }, [items, view, f, query, ctx]);

  const anyActive = activeFilterCount(f) > 0;
  const deadlineLabel = DEADLINE_WINDOWS.find((w) => w.id === f.deadline)?.label;

  return (
    <div className="relative mb-3.5 flex flex-wrap items-center gap-1.5">
      {pill(
        'verdict',
        summarize(
          'Verdict',
          f.verdicts.map((v) => VERDICT_LABELS[v]),
        ),
        f.verdicts.length > 0,
        () => set({ verdicts: [] }),
        () => (
          <OptionMenu
            label="Verdict"
            multi
            options={verdictOptions}
            selected={f.verdicts}
            onPick={(v) => set({ verdicts: toggle(f.verdicts, v) })}
          />
        ),
      )}
      {pill(
        'score',
        f.minScore === null ? 'Score' : `Score ≥ ${f.minScore}`,
        f.minScore !== null,
        () => set({ minScore: null }),
        () => (
          <OptionMenu
            label="Minimum score"
            options={scoreOptions}
            selected={f.minScore === null ? [] : [String(f.minScore)]}
            onPick={(v) => {
              set({ minScore: f.minScore === Number(v) ? null : Number(v) });
              close();
            }}
          />
        ),
      )}
      {pill(
        'remote',
        summarize(
          'Remote',
          f.remote.map((r) => REMOTE_LABELS[r]),
        ),
        f.remote.length > 0,
        () => set({ remote: [] }),
        () => (
          <OptionMenu
            label="Remote"
            multi
            options={remoteOptions}
            selected={f.remote}
            onPick={(v) => set({ remote: toggle(f.remote, v) })}
          />
        ),
      )}
      {pill(
        'location',
        summarize('Location', f.locations),
        f.locations.length > 0,
        () => set({ locations: [] }),
        () => (
          <OptionMenu
            label="Location"
            multi
            options={locationOptions}
            selected={f.locations}
            onPick={(v) => set({ locations: toggle(f.locations, v) })}
          />
        ),
      )}
      {pill(
        'deadline',
        deadlineLabel ?? 'Deadline',
        f.deadline !== null,
        () => set({ deadline: null }),
        () => (
          <OptionMenu
            label="Deadline window"
            options={deadlineOptions}
            selected={f.deadline ? [f.deadline] : []}
            onPick={(v) => {
              set({ deadline: f.deadline === v ? null : v });
              close();
            }}
          />
        ),
      )}
      {pill(
        'source',
        summarize('Source', f.sources),
        f.sources.length > 0,
        () => set({ sources: [] }),
        () => (
          <OptionMenu
            label="Source"
            multi
            options={sourceOptions}
            selected={f.sources}
            onPick={(v) => set({ sources: toggle(f.sources, v) })}
            footer={
              f.sources.length ? (
                <MenuAction onClick={() => set({ sources: [] })}>Clear</MenuAction>
              ) : null
            }
          />
        ),
      )}
      {f.newOnly && (
        <FilterPill
          label="New since last visit"
          active
          onClick={() => set({ newOnly: false })}
          onClear={() => set({ newOnly: false })}
        />
      )}
      {f.matches && (
        <FilterPill
          label={`${f.matches.length} new match${f.matches.length === 1 ? '' : 'es'}`}
          active
          onClick={() => set({ matches: null })}
          onClear={() => set({ matches: null })}
        />
      )}
      {anyActive && (
        <button
          type="button"
          onClick={() => onChange(NO_FILTERS)}
          className="focus-ring ml-1 rounded-xs text-footnote text-fg-3 hover:text-fg-2"
        >
          Clear all
        </button>
      )}
      <div className="ml-auto text-footnote text-fg-3 tabular-nums" aria-live="polite">
        {resultCount === 1 ? '1 result' : `${resultCount} results`}
      </div>
    </div>
  );
});
