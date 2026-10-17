import {
  ArchiveX,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  Copy,
  ExternalLink,
  Flag,
  Plus,
  Star,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { VERDICT_THRESHOLDS } from '../../../../core/rules/thresholds';
import type { OpportunityDetail } from '../../../../shared/ipc';
import { Badge, VerdictBadge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { OrgAvatar } from '../../../components/Brand';
import { Button } from '../../../components/Button';
import { Drawer, DrawerClose } from '../../../components/Drawer';
import { Icon } from '../../../components/Icon';
import { ScoreRing } from '../../../components/ScoreRing';
import { Shimmer, Skeleton } from '../../../components/Skeleton';
import { cn } from '../../../components/lib/cn';
import { formatLongDate, formatShortDate, shortAge } from '../../lib/dates';
import {
  deadlineChip,
  deepReviewText,
  monogram,
  monogramHue,
  parseEligibilityNotes,
  REMOTE_LABELS,
  VERDICT_HEADLINES,
  wordCount,
  type Ctx,
} from '../../lib/opportunities';
import { cleanIpcError } from '../../lib/settings-helpers';
import { sourceIcon } from './icons';
import type { OpportunitiesApi } from './useOpportunities';

/** "Posted 2d ago" (design wording), "Posted just now" under an hour. */
function postedLabel(iso: string, now: Date): string {
  const age = shortAge(iso, now);
  return age === 'now' ? 'Posted just now' : `Posted ${age} ago`;
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'rounded-2xl bg-surface px-4.5 py-4 hairline border-line shadow-card',
        className,
      )}
    >
      {children}
    </section>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="m-0 text-headline font-semibold">{children}</h3>;
}

function ScoreCard({ d }: { d: OpportunityDetail }) {
  // Biggest contributions first, penalties last (design order).
  const signals = [...(d.breakdown?.signals ?? [])].sort((a, b) => b.points - a.points);
  const max = Math.max(1, ...signals.map((s) => Math.abs(s.points)));
  return (
    <Card className="p-4.5">
      <div className="flex items-center gap-4.5">
        <ScoreRing score={d.score} size="hero" />
        <div className="min-w-0 flex-1">
          <div className="text-caption-2 font-semibold tracking-caps text-fg-3 uppercase">
            Score breakdown
          </div>
          <div className="mt-0.5 text-title-3 font-semibold tracking-title-3">
            {d.verdict ? VERDICT_HEADLINES[d.verdict] : 'Not scored yet'}
          </div>
          <div className="mt-0.5 text-subhead text-fg-2">
            {d.breakdown
              ? `Apply at ${VERDICT_THRESHOLDS.apply} or more. Scored by ${signals.length} plain rules.`
              : 'Scores are computed by the rules engine.'}
          </div>
        </div>
        <span className="self-start">
          <VerdictBadge verdict={d.verdict} size="lg" />
        </span>
      </div>
      {signals.length > 0 && (
        <ul className="m-0 mt-4.5 flex list-none flex-col gap-2.75 hairline-t border-line p-0 pt-4">
          {signals.map((s) => {
            const tone = s.points > 0 ? 'pos' : s.points < 0 ? 'neg' : 'zero';
            return (
              <li
                key={s.id}
                className="grid grid-cols-[150px_minmax(0,1fr)_36px] items-center gap-3"
              >
                <div className="min-w-0">
                  <div className="text-body font-medium">{s.label}</div>
                  <div className="truncate text-caption-2 text-fg-3">{s.detail}</div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-fill" aria-hidden="true">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      tone === 'pos'
                        ? 'bg-green-fill'
                        : tone === 'neg'
                          ? 'bg-red-fill'
                          : 'bg-gray-fill',
                    )}
                    style={{ width: `${Math.max(2, (Math.abs(s.points) / max) * 100)}%` }}
                  />
                </div>
                <div
                  className={cn(
                    'text-right text-body font-semibold tabular-nums',
                    tone === 'pos' ? 'text-green' : tone === 'neg' ? 'text-red' : 'text-fg-3',
                  )}
                >
                  {s.points > 0 ? `+${s.points}` : s.points < 0 ? `−${-s.points}` : '0'}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function EligibilityCard({ text }: { text: string | null }) {
  const notes = parseEligibilityNotes(text);
  if (!notes.length) return null;
  return (
    <Card>
      <div className="mb-2.5 flex items-center gap-2">
        <CardTitle>Eligibility notes</CardTitle>
        <Badge tone="amber" strong size="sm">
          {notes.length === 1 ? '1 flag' : `${notes.length} flags`}
        </Badge>
        <span className="ml-auto text-caption text-fg-3">Flagged, not skipped</span>
      </div>
      {notes.map((n) => (
        <div key={n.label + n.detail} className="flex gap-2.5 hairline-t border-line py-2">
          <Icon icon={Flag} size={16} className="mt-px shrink-0 text-amber-fill" />
          <div>
            <div className="text-body font-medium">{n.label}</div>
            {n.detail && <div className="text-footnote text-fg-2">{n.detail}</div>}
          </div>
        </div>
      ))}
    </Card>
  );
}

const STATUS_BADGE = {
  confirmed: (
    <Badge tone="green" strong size="sm" icon={CircleCheck}>
      Confirmed
    </Badge>
  ),
  expected: (
    <Badge tone="expected" strong size="sm" icon={CircleDashed}>
      Expected, unconfirmed
    </Badge>
  ),
  rolling: (
    <Badge tone="neutral" strong size="sm">
      Rolling
    </Badge>
  ),
  unknown: (
    <Badge tone="outline" size="sm">
      Unknown
    </Badge>
  ),
  closed: (
    <Badge tone="gray" strong size="sm">
      Closed
    </Badge>
  ),
} as const;

function DeadlineCard({ d, ctx }: { d: OpportunityDetail; ctx: Ctx }) {
  const chip = deadlineChip(d, ctx);
  const source = d.sources[0]?.name;
  return (
    <Card>
      <div className="flex items-center gap-2">
        <CardTitle>Deadline</CardTitle>
        {STATUS_BADGE[d.deadline_status]}
      </div>
      <div className="mt-2.5 flex items-baseline gap-2.5">
        <div className="text-figure font-semibold tracking-figure tabular-nums">
          {d.deadline_at
            ? formatLongDate(d.deadline_at, ctx.timeZone)
            : d.deadline_status === 'rolling'
              ? 'Rolling, apply any time'
              : 'No deadline found'}
        </div>
        {d.deadline_at && (
          <span
            className={cn(
              'text-footnote font-semibold',
              chip.tone === 'red' ? 'text-red' : chip.tone === 'amber' ? 'text-amber' : 'text-fg-2',
            )}
          >
            {chip.long}
          </span>
        )}
      </div>
      {d.deadline_text && (
        <blockquote className="m-0 mt-2.5 rounded-lg bg-fill px-3 py-2.5 text-subhead leading-normal text-fg-2">
          “{d.deadline_text}”
          <div className="mt-1 text-caption-2 text-fg-3">
            Quoted from the posting{source ? ` · ${source}` : ''}
          </div>
        </blockquote>
      )}
    </Card>
  );
}

function DescriptionCard({ d }: { d: OpportunityDetail }) {
  const [open, setOpen] = useState(false);
  if (!d.description) return null;
  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="focus-ring flex w-full items-center gap-2 rounded-xs text-left"
      >
        <CardTitle>Original description</CardTitle>
        <span className="text-caption text-fg-3">
          {[d.sources[0]?.name, `${wordCount(d.description)} words`].filter(Boolean).join(' · ')}
        </span>
        <Icon icon={open ? ChevronUp : ChevronDown} size={15} className="ml-auto text-fg-3" />
      </button>
      <div
        className={cn(
          'mt-2.5 text-subhead leading-relaxed whitespace-pre-line text-fg-2 select-text',
          !open && 'max-h-15.5 overflow-hidden mask-fade-bottom',
        )}
      >
        {d.description}
      </div>
    </Card>
  );
}

function SourcesCard({
  d,
  ctx,
  onOpenLink,
}: {
  d: OpportunityDetail;
  ctx: Ctx;
  onOpenLink: (url: string) => void;
}) {
  return (
    <Card className="pb-2">
      <div className="mb-1.5">
        <CardTitle>
          {d.sources.length === 1 ? 'Found on 1 source' : `Found on ${d.sources.length} sources`}
        </CardTitle>
      </div>
      {d.sources.map((s, i) => (
        <div key={s.url} className="flex h-10 items-center gap-2.5 hairline-t border-line">
          <Icon icon={sourceIcon(s.access_method)} size={15} className="shrink-0 text-fg-3" />
          <span className="min-w-0 truncate text-body font-medium">{s.name}</span>
          <span className="shrink-0 text-footnote text-fg-3">
            {i === 0 ? 'First seen ' : ''}
            {formatShortDate(s.first_seen_at, ctx.timeZone)}
          </span>
          <button
            type="button"
            aria-label={`Open on ${s.name}`}
            onClick={() => onOpenLink(s.url)}
            className="focus-ring ml-auto grid size-7 shrink-0 place-items-center rounded-sm text-accent-text hover:bg-fill"
          >
            <Icon icon={ExternalLink} size={14} />
          </button>
        </div>
      ))}
    </Card>
  );
}

const SKELETON_DELAY_MS = 250;

function DrawerSkeleton() {
  return (
    <div className="relative flex flex-col gap-3 overflow-hidden px-6 pt-5" aria-busy="true">
      <div className="flex items-center gap-3">
        <Skeleton strong className="size-9 rounded-md" />
        <Skeleton strong className="h-3 w-40" />
      </div>
      <Skeleton strong className="h-5 w-[80%]" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Shimmer />
    </div>
  );
}

interface OpportunityDrawerProps {
  id: number | null;
  /** Fallback for the starred state shown in the header (kept in sync with the list). */
  starred: boolean;
  ctx: Ctx;
  wide: boolean;
  api: OpportunitiesApi;
  onClose: () => void;
  onStar: () => void;
  onDismiss: () => void;
}

/** Detail drawer for one opportunity (design: 520 px, score card, eligibility, deadline, sources). */
export function OpportunityDrawer({
  id,
  starred,
  ctx,
  wide,
  api,
  onClose,
  onStar,
  onDismiss,
}: OpportunityDrawerProps) {
  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    let live = true;
    window.radar.opportunities.get(id).then(
      (d) => {
        if (!live) return;
        setDetail(d);
        setError(null);
      },
      (err: unknown) => {
        if (!live) return;
        console.error('[opportunities] detail failed', err);
        setError(cleanIpcError(err));
      },
    );
    return () => {
      live = false;
    };
  }, [id]);

  const d = detail && detail.id === id ? detail : null;

  // Only the drawer itself moves while it opens: the details load in a few milliseconds, so the
  // panel stays empty for that moment instead of flashing a skeleton that is swapped out mid-slide.
  // The skeleton appears only when loading is actually slow.
  const [slowId, setSlowId] = useState<number | null>(null);
  const loading = id !== null && !d && !error;
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlowId(id), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [loading, id]);
  const slow = slowId === id;

  return (
    <Drawer
      open={id !== null}
      onClose={onClose}
      label={d ? `${d.title}, ${d.org}` : 'Opportunity'}
      wide={wide}
    >
      {error && !d ? (
        <div className="flex flex-col gap-3 p-6">
          <div className="ml-auto">
            <DrawerClose onClose={onClose} />
          </div>
          <Banner title="This opportunity could not be loaded." description={error} />
        </div>
      ) : !d ? (
        slow && <DrawerSkeleton />
      ) : (
        <>
          <div className="hairline-b border-line px-6 pt-5 pb-4">
            <div className="flex items-center gap-3">
              <OrgAvatar initials={monogram(d.org)} hue={monogramHue(d.org)} size="md" />
              <div className="min-w-0">
                <div className="text-body font-semibold">{d.org}</div>
                <div className="truncate text-footnote text-fg-2">
                  {[
                    d.location,
                    REMOTE_LABELS[d.remote_type],
                    postedLabel(d.posted_at ?? d.first_seen_at, ctx.now),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className="ml-auto flex shrink-0 gap-1.5">
                <button
                  type="button"
                  aria-label={starred ? 'Unstar' : 'Star'}
                  aria-pressed={starred}
                  onClick={onStar}
                  className={cn(
                    'focus-ring grid size-7 place-items-center rounded-full bg-surface hairline border-line-2',
                    starred ? 'text-amber-fill' : 'text-fg-3',
                  )}
                >
                  <Icon icon={Star} size={15} fill={starred ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={onDismiss}
                  className="focus-ring grid size-7 place-items-center rounded-full bg-surface hairline border-line-2 text-fg-2"
                >
                  <Icon icon={ArchiveX} size={15} />
                </button>
              </div>
              <DrawerClose onClose={onClose} />
            </div>
            <h2 className="m-0 mt-3.5 text-title-2 font-semibold tracking-title-2 text-pretty select-text">
              {d.title}
            </h2>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Button
                variant="primary"
                size="lg"
                iconRight={ArrowUpRight}
                className="shadow-primary"
                onClick={() => api.openExternal(d.apply_url ?? d.url)}
              >
                Apply
              </Button>
              <Button size="lg" icon={Plus} onClick={() => void api.addToPipeline([d.id])}>
                Add to pipeline
              </Button>
              <Button
                size="lg"
                icon={Copy}
                onClick={() =>
                  void api.copy(deepReviewText(d, ctx), 'Copied posting and score breakdown')
                }
              >
                Copy for deep review
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-x-hidden overflow-y-auto bg-bg px-6 pt-5 pb-8">
            <ScoreCard d={d} />
            <EligibilityCard text={d.eligibility_notes} />
            <DeadlineCard d={d} ctx={ctx} />
            <DescriptionCard key={d.id} d={d} />
            <SourcesCard d={d} ctx={ctx} onOpenLink={api.openExternal} />
          </div>
        </>
      )}
    </Drawer>
  );
}
