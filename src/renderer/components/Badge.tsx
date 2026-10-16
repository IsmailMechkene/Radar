import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

export type BadgeTone =
  'green' | 'amber' | 'red' | 'accent' | 'gray' | 'neutral' | 'outline' | 'expected';

const TONES: Record<BadgeTone, string> = {
  green: 'bg-green-soft text-green',
  amber: 'bg-amber-soft text-amber',
  red: 'bg-red-soft text-red',
  accent: 'bg-accent-soft text-accent-text',
  gray: 'bg-gray-soft text-gray',
  neutral: 'bg-fill text-fg-2',
  outline: 'text-fg-3 hairline border-line-2',
  // "Expected, unconfirmed": dashed outline, never filled.
  expected: 'text-fg-2 border border-dashed border-fg-3',
};

interface BadgeProps {
  tone?: BadgeTone;
  /** Verdicts and status labels are semibold; deadline chips are medium. */
  strong?: boolean;
  /** Dashed outline in the current color (inferred dates, e.g. "~ Dec 15"). */
  dashed?: boolean;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

/** Badge (22 px, pill): verdicts, deadline chips, statuses. */
export function Badge({ tone = 'neutral', strong, dashed, icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5.5 w-max items-center gap-1 rounded-full px-2 text-caption whitespace-nowrap',
        strong ? 'font-semibold' : 'font-medium',
        TONES[tone],
        dashed && 'border border-dashed border-current',
        className,
      )}
    >
      {icon && <Icon icon={icon} size={12} />}
      {children}
    </span>
  );
}

export type Verdict = 'apply' | 'maybe' | 'needs_review' | 'skip';

const VERDICTS: Record<Verdict, { label: string; tone: BadgeTone }> = {
  apply: { label: 'Apply', tone: 'green' },
  maybe: { label: 'Maybe', tone: 'amber' },
  needs_review: { label: 'Needs review', tone: 'accent' },
  skip: { label: 'Skip', tone: 'gray' },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICTS[verdict];
  return (
    <Badge tone={v.tone} strong>
      {v.label}
    </Badge>
  );
}

export type CountTone = 'accent' | 'amber' | 'red' | 'gray';

const COUNT_TONES: Record<CountTone, string> = {
  accent: 'bg-accent text-on-accent',
  amber: 'bg-amber-soft text-amber',
  red: 'bg-red-soft text-red',
  gray: 'bg-fill-2 text-fg-2',
};

/** Count badge used in the sidebar ("12 new", "3 due"). */
export function CountBadge({ tone = 'gray', children }: { tone?: CountTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.75 py-px text-caption-2 font-semibold tabular-nums',
        COUNT_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export type DotTone = 'healthy' | 'slow' | 'broken' | 'paused';

const DOT: Record<DotTone, string> = {
  healthy: 'bg-green-fill shadow-[0_0_0_var(--ring-dot)_var(--grs)]',
  slow: 'bg-amber-fill shadow-[0_0_0_var(--ring-dot)_var(--ams)]',
  broken: 'bg-red-fill shadow-[0_0_0_var(--ring-dot)_var(--rds)]',
  paused: 'bg-gray-fill shadow-[0_0_0_var(--ring-dot)_var(--gys)]',
};

/** 8 px status dot with a soft halo: source health, scan state. */
export function StatusDot({ tone, pulse }: { tone: DotTone; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        DOT[tone],
        pulse && 'animate-pulse',
      )}
    />
  );
}
