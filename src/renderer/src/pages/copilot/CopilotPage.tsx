import {
  ExternalLink,
  Kanban,
  RotateCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { DIMENSIONS } from '../../../../core/copilot/reviews';
import type { CopilotItem, StoredReview } from '../../../../shared/ipc';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { OrgAvatar } from '../../../components/Brand';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { ScoreRing } from '../../../components/ScoreRing';
import { SegmentedControl } from '../../../components/SegmentedControl';
import { Skeleton } from '../../../components/Skeleton';
import { useToast } from '../../../components/Toast';
import { cn } from '../../../components/lib/cn';
import {
  DIMENSION_LABELS,
  FILTERS,
  gradeTone,
  itemState,
  matchesFilter,
  reviewedLine,
  statusLine,
  type FilterId,
  type ItemState,
} from '../../lib/copilot';
import { notifyDataChanged } from '../../lib/data-events';
import { monogram, monogramHue, REMOTE_LABELS } from '../../lib/opportunities';
import { routeHref } from '../../lib/router';
import { cleanIpcError } from '../../lib/settings-helpers';
import { useSettings } from '../../state/settings';
import { PageTitle } from '../PageTitle';
import { useCopilot } from './useCopilot';

const STATE_LABEL: Record<Exclude<ItemState, 'reviewed'>, string> = {
  reviewing: 'Reviewing…',
  queued: 'Queued',
  failed: 'Failed',
  waiting: 'Waiting',
};

/** Five small segments, filled up to the score (1 to 5). */
function Meter({ score }: { score: number }) {
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={cn('h-1.5 w-3 rounded-full', n <= score ? 'bg-accent' : 'bg-fill-2')}
        />
      ))}
    </span>
  );
}

function PointList({ title, points, tone }: { title: string; points: string[]; tone?: 'red' }) {
  if (points.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h3
        className={cn('m-0 text-footnote font-semibold', tone === 'red' ? 'text-red' : 'text-fg-2')}
      >
        {title}
      </h3>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-4.5 text-body">
        {points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </section>
  );
}

function ReviewView({ stored, timeZone }: { stored: StoredReview; timeZone: string }) {
  const r = stored.review;
  return (
    <div className="flex flex-col gap-5 px-5 py-4.5">
      <div className="flex items-center gap-3">
        <Badge tone={gradeTone(stored.grade)} strong size="lg">
          Grade {stored.grade}
        </Badge>
        <span className="text-figure font-semibold tabular-nums">
          {r.score.toFixed(1)}
          <span className="text-subhead font-normal text-fg-3"> / 5</span>
        </span>
        <span className="ml-auto text-footnote text-fg-3">
          {reviewedLine(stored.reviewedAt, stored.model, timeZone)}
        </span>
      </div>
      <p className="m-0 text-body leading-relaxed">{r.summary}</p>
      <div className="rounded-lg bg-accent-soft px-3.5 py-2.75 text-body">
        <span className="font-semibold text-accent">Next step: </span>
        {r.nextStep}
      </div>
      <section className="flex flex-col">
        {DIMENSIONS.map((d) => (
          <div
            key={d}
            className="grid grid-cols-[132px_70px_minmax(0,1fr)] items-baseline gap-3 py-1.75 hairline-b border-line"
          >
            <span className="text-subhead font-medium">{DIMENSION_LABELS[d]}</span>
            <span className="flex items-center gap-1.5 self-center">
              <Meter score={r.dimensions[d].score} />
              <span className="sr-only">{r.dimensions[d].score} of 5</span>
            </span>
            <span className="text-subhead text-fg-2">{r.dimensions[d].note}</span>
          </div>
        ))}
      </section>
      <div className="grid grid-cols-2 gap-5">
        <PointList title="Strengths" points={r.strengths} />
        <PointList title="Gaps" points={r.gaps} />
      </div>
      <PointList title="Red flags" points={r.redFlags} tone="red" />
      <div className="text-subhead text-fg-2">
        <span className="font-semibold text-fg">Pay: </span>
        {r.salary ?? 'Not stated in the posting.'}
      </div>
    </div>
  );
}

export function CopilotPage() {
  const { settings } = useSettings();
  const tz = settings?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const toast = useToast();
  const { items, status, setStatus, error, reload } = useCopilot();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterId>('all');
  const [text, setText] = useState('');

  const enabled = settings?.copilot.enabled ?? false;
  const hasCv = (settings?.masterCv.trim() ?? '') !== '';
  const ready = enabled && hasCv;
  const queued = new Set(status?.queued ?? []);
  const visible = (items ?? []).filter((i) => matchesFilter(i, filter, text));
  const item = (items ?? []).find((i) => i.id === selectedId) ?? visible[0] ?? null;
  const waitingCount = (items ?? []).filter((i) => !i.stored).length;
  const failure = item ? status?.failures.find((f) => f.id === item.id) : undefined;

  async function act(what: string, call: () => Promise<unknown>) {
    try {
      await call();
    } catch (err) {
      console.error(`[copilot] ${what} failed`, err);
      toast({ tone: 'error', message: `${what} failed: ${cleanIpcError(err)}` });
    }
  }

  const reviewAll = () =>
    act('Review', async () => {
      const s = await window.radar.copilot.reviewWaiting();
      setStatus(s);
      toast({ message: `Reviewing ${s.queued.length + (s.current ? 1 : 0)} postings` });
    });
  const reviewOne = (i: CopilotItem) =>
    act('Review', async () => setStatus(await window.radar.copilot.review([i.id])));
  const stop = () =>
    act('Stop', async () => {
      setStatus(await window.radar.copilot.stop());
      toast({ message: 'Stopped. Finished reviews are kept.' });
    });
  const addToPipeline = (i: CopilotItem) =>
    act('Add to Pipeline', async () => {
      const r = await window.radar.pipeline.add([i.id]);
      notifyDataChanged();
      toast({
        message:
          r.added.length > 0
            ? `${i.org} added to the Pipeline`
            : `${i.org} is already in the Pipeline`,
      });
    });

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-4">
        <PageTitle
          title="Radar Copilot"
          subtitle={
            items
              ? `AI reviews by your own Claude Code of what your rules passed. ${statusLine(items, status)}.`
              : 'AI reviews by your own Claude Code of what your rules passed.'
          }
        />
        {status?.running ? (
          <Button icon={Square} onClick={() => void stop()}>
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={Sparkles}
            disabled={!ready || waitingCount === 0}
            onClick={() => void reviewAll()}
          >
            {waitingCount > 0 ? `Review ${waitingCount} waiting` : 'Nothing waiting'}
          </Button>
        )}
      </div>

      {settings && !ready && (
        <div className="mb-4">
          <Banner
            tone="warning"
            title={enabled ? 'Add your master CV first.' : 'Radar Copilot is off.'}
            description={
              enabled
                ? 'Every review compares a posting with your CV.'
                : 'Turn it on in Settings. It uses your own Claude Code; Radar works fully without it.'
            }
            action={
              <Button size="sm" onClick={() => (window.location.hash = routeHref('settings'))}>
                Open Settings
              </Button>
            }
          />
        </div>
      )}
      {status?.lastError && (
        <div className="mb-4">
          <Banner title="The last review failed." description={status.lastError} />
        </div>
      )}

      {error ? (
        <Banner
          title="Radar Copilot could not be loaded."
          description={error}
          action={
            <Button size="sm" icon={RotateCw} onClick={() => void reload()}>
              Retry
            </Button>
          }
        />
      ) : items === null ? (
        <Skeleton className="h-177.5 w-full rounded-3xl" />
      ) : items.length === 0 ? (
        <div className="grid place-items-center rounded-3xl bg-surface px-6 py-14 text-center hairline border-line shadow-card">
          <Icon icon={Sparkles} size={18} className="text-fg-3" />
          <div className="mt-2 text-headline font-semibold">Nothing to review yet</div>
          <p className="mt-1 max-w-110 text-subhead text-fg-2">
            Postings your rules mark Apply or Maybe show up here. Run a scan, or loosen the Rules.
          </p>
        </div>
      ) : (
        <div className="grid h-177.5 grid-cols-[320px_minmax(0,1fr)] overflow-hidden rounded-3xl bg-surface hairline border-line shadow-card">
          <div className="flex min-h-0 flex-col bg-surface-2 hairline-r border-line">
            <div className="flex flex-col gap-2 p-3">
              <SegmentedControl
                label="Show"
                value={filter}
                segments={FILTERS}
                onChange={setFilter}
              />
              <label className="flex h-7 items-center gap-1.75 rounded-sm bg-fill px-2.25 text-subhead text-fg-3 focus-within:shadow-focus">
                <Icon icon={Search} size={13} />
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Filter postings"
                  aria-label="Filter postings"
                  className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-3"
                />
              </label>
            </div>
            <div
              role="listbox"
              aria-label="Postings"
              className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2 pb-2"
            >
              {visible.map((i) => {
                const st = itemState(i, status, queued.has(i.id));
                const active = item?.id === i.id;
                return (
                  <button
                    key={i.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => setSelectedId(i.id)}
                    className={cn(
                      'focus-ring flex items-center gap-2.5 rounded-lg px-2.5 py-2.25 text-left',
                      active ? 'bg-accent-soft' : 'hover:bg-fill',
                    )}
                  >
                    <OrgAvatar initials={monogram(i.org)} hue={monogramHue(i.org)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-semibold">{i.title}</div>
                      <div className="truncate text-footnote text-fg-2">{i.org}</div>
                    </div>
                    {st === 'reviewed' && i.stored ? (
                      <Badge tone={gradeTone(i.stored.grade)} strong size="sm">
                        {i.stored.grade} {i.stored.review.score.toFixed(1)}
                      </Badge>
                    ) : (
                      <span
                        className={cn(
                          'shrink-0 text-caption-2 whitespace-nowrap',
                          st === 'failed'
                            ? 'text-red'
                            : st === 'reviewing'
                              ? 'text-accent'
                              : 'text-fg-3',
                        )}
                      >
                        {STATE_LABEL[st as Exclude<ItemState, 'reviewed'>]}
                      </span>
                    )}
                  </button>
                );
              })}
              {visible.length === 0 && (
                <div className="px-2.5 py-4 text-subhead text-fg-3">No match.</div>
              )}
            </div>
          </div>

          {item ? (
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="flex items-center gap-2.5 px-5 py-3.5 hairline-b border-line">
                <OrgAvatar initials={monogram(item.org)} hue={monogramHue(item.org)} size="xs" />
                <div className="min-w-0">
                  <h2 className="m-0 truncate text-callout font-semibold tracking-title-3">
                    {item.title}
                  </h2>
                  <div className="truncate text-footnote text-fg-2">
                    {[item.org, item.location, REMOTE_LABELS[item.remoteType]]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <ScoreRing score={item.ruleScore} size="sm" />
                  <Button
                    size="sm"
                    icon={ExternalLink}
                    onClick={() => void act('Open', () => window.radar.app.openExternal(item.url))}
                  >
                    Open
                  </Button>
                  <Button size="sm" icon={Kanban} onClick={() => void addToPipeline(item)}>
                    Add to Pipeline
                  </Button>
                  <Button
                    size="sm"
                    variant={item.stored ? 'secondary' : 'primary'}
                    icon={Sparkles}
                    disabled={!ready || queued.has(item.id) || status?.current?.id === item.id}
                    onClick={() => void reviewOne(item)}
                  >
                    {item.stored ? 'Review again' : 'Review'}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {failure && (
                  <div className="mx-5 mt-4">
                    <Banner title="This review failed." description={failure.problem} />
                  </div>
                )}
                {item.problem && (
                  <div className="mx-5 mt-4">
                    <Banner tone="warning" title={item.problem} />
                  </div>
                )}
                {item.stored ? (
                  <ReviewView stored={item.stored} timeZone={tz} />
                ) : (
                  <div className="grid place-items-center px-6 py-16 text-center">
                    <Icon
                      icon={status?.current?.id === item.id ? Sparkles : TriangleAlert}
                      size={18}
                      className="text-fg-3"
                    />
                    <div className="mt-2 text-headline font-semibold">
                      {status?.current?.id === item.id
                        ? 'Claude Code is reviewing this posting…'
                        : queued.has(item.id)
                          ? 'Queued for review'
                          : 'Not reviewed yet'}
                    </div>
                    <p className="mt-1 max-w-110 text-subhead text-fg-2">
                      A review takes about a minute and uses a little of your Claude plan.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2.5 px-5 py-3.5 hairline-t border-line">
                <Icon icon={ShieldCheck} size={16} className="shrink-0 text-green" />
                <span className="min-w-0 text-subhead text-fg-2">
                  <b className="font-semibold text-fg">The rule score stays as it is.</b> Reviews
                  are a second opinion from your Claude Code; Radar never applies for you.
                </span>
              </div>
            </div>
          ) : (
            <div className="grid place-items-center text-subhead text-fg-3">Pick a posting.</div>
          )}
        </div>
      )}
    </div>
  );
}
