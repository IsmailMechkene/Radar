import { CircleCheck, CircleDashed, Globe, Pencil, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ProgramItem } from '../../../../shared/ipc';
import { Badge } from '../../../components/Badge';
import { Icon } from '../../../components/Icon';
import { cn } from '../../../components/lib/cn';
import { monogram, monogramHue } from '../../lib/opportunities';
import {
  alertTime,
  datesStatus,
  DATES_LABEL,
  diffLines,
  displayUrl,
  lastCycle,
  nextCheck,
  nextWindow,
  PROGRAM_STATUS_LABEL,
  typicalWindow,
} from '../../lib/programs';

function DatesBadge({ p }: { p: ProgramItem }) {
  const s = datesStatus(p);
  if (s === 'confirmed') {
    return (
      <Badge tone="green" strong size="sm" icon={CircleCheck}>
        {DATES_LABEL[s]}
      </Badge>
    );
  }
  if (s === 'expected') {
    return (
      <Badge tone="expected" strong size="sm" icon={CircleDashed}>
        {DATES_LABEL[s]}
      </Badge>
    );
  }
  return (
    <Badge tone={s === 'rolling' ? 'neutral' : 'outline'} strong size="sm">
      {DATES_LABEL[s]}
    </Badge>
  );
}

interface Props {
  p: ProgramItem;
  now: Date;
  tz: string;
  checking: boolean;
  onEdit: (fromAlert: boolean) => void;
  onCheck: () => void;
  onReviewed: () => void;
  onOpenLink: (url: string) => void;
}

/** One watched program, as in the design: window, last cycle, next check, change alert. */
export function ProgramCard({
  p,
  now,
  tz,
  checking,
  onEdit,
  onCheck,
  onReviewed,
  onOpenLink,
}: Props) {
  const changed = p.alert_id !== null;
  const check = nextCheck(p, now, tz);
  const subtitle = [
    p.org && p.org !== p.name ? p.org : null,
    p.status !== 'watching' ? PROGRAM_STATUS_LABEL[p.status] : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <article
      aria-label={p.name}
      className={cn(
        'flex flex-col gap-3.5 rounded-3xl bg-surface p-4.5 shadow-card',
        changed ? 'border border-amber-fill/55' : 'hairline border-line',
        p.status === 'not_applicable' || p.status === 'closed' ? 'opacity-70' : '',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-lg text-body font-semibold text-on-accent"
          style={{
            background: `oklch(var(--monogram-l) var(--monogram-c) ${monogramHue(p.org ?? p.name)})`,
          }}
        >
          {monogram(p.org ?? p.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-callout font-semibold tracking-title-3">{p.name}</h2>
          {subtitle && <div className="mt-px text-footnote text-fg-2">{subtitle}</div>}
        </div>
        <button
          type="button"
          aria-label={`Edit ${p.name}`}
          onClick={() => onEdit(false)}
          className="focus-ring grid size-7 place-items-center rounded-sm text-fg-3 hover:bg-fill hover:text-fg-2"
        >
          <Icon icon={Pencil} size={14} />
        </button>
      </div>

      <div>
        <DatesBadge p={p} />
      </div>

      <dl className="m-0 grid grid-cols-[100px_minmax(0,1fr)] gap-y-1.75 text-subhead">
        <dt className="text-fg-3">Typical window</dt>
        <dd className="m-0 font-medium">{typicalWindow(p)}</dd>
        <dt className="text-fg-3">Next cycle</dt>
        <dd className="m-0 tabular-nums">{nextWindow(p, tz)}</dd>
        <dt className="text-fg-3">Last cycle</dt>
        <dd className="m-0 tabular-nums">{lastCycle(p)}</dd>
        <dt className="text-fg-3">Next check</dt>
        <dd
          className={cn(
            'm-0 tabular-nums',
            check.tone === 'error' && 'text-red',
            check.tone === 'muted' && 'text-fg-3',
          )}
          title={p.last_error ?? undefined}
        >
          {check.label}
        </dd>
      </dl>

      {changed && (
        <div role="status" className="rounded-lg bg-amber-soft p-3">
          <div className="flex items-center gap-1.5 text-subhead font-semibold text-amber">
            <Icon icon={TriangleAlert} size={14} />
            Page changed, review
            <span className="ml-auto text-caption font-medium">
              {p.alert_at ? alertTime(p.alert_at, now, tz) : ''}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-0.75 font-mono text-caption-2 leading-normal">
            {diffLines(p.alert_body ?? '').map((l, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-2xs px-1.5 py-0.5 break-words',
                  l.kind === 'removed' && 'bg-red-soft text-red',
                  l.kind === 'added' && 'bg-green-soft text-green',
                  l.kind === 'more' && 'text-fg-2',
                )}
              >
                {l.kind !== 'more' && (
                  <span className="opacity-70">{l.kind === 'removed' ? '− ' : '+ '}</span>
                )}
                <span className={cn(l.kind === 'removed' && 'line-through')}>{l.text}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => onEdit(true)}
              className="focus-ring h-6.5 rounded-sm bg-amber-fill px-2.5 text-footnote font-semibold text-on-accent hover:brightness-96"
            >
              Update deadline
            </button>
            <button
              type="button"
              onClick={onReviewed}
              className="focus-ring h-6.5 rounded-sm bg-surface px-2.5 text-footnote font-medium hairline border-line-2 hover:bg-fill"
            >
              Mark reviewed
            </button>
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center gap-1.5 pt-3 text-footnote text-fg-3 hairline-t border-line">
        <Icon icon={Globe} size={13} className="shrink-0" />
        {p.url ? (
          <button
            type="button"
            onClick={() => onOpenLink(p.url!)}
            className="focus-ring min-w-0 truncate rounded-2xs text-left hover:text-fg-2 hover:underline"
            title={p.url}
          >
            {displayUrl(p.url)}
          </button>
        ) : (
          <span className="truncate">No official page confirmed yet</span>
        )}
        {p.watch_url && (
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="focus-ring ml-auto flex shrink-0 items-center gap-1 rounded-2xs font-medium whitespace-nowrap text-accent-text disabled:opacity-40"
          >
            <Icon icon={RefreshCw} size={12} className={cn(checking && 'animate-spin')} />
            {checking ? 'Checking' : 'Check now'}
          </button>
        )}
      </div>
    </article>
  );
}
