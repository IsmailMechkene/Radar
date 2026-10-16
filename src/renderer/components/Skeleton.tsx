import { cn } from './lib/cn';

/** Placeholder block while loading. `strong` uses fill-2 (titles, rings); default uses fill. */
export function Skeleton({ className, strong }: { className?: string; strong?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('block rounded-2xs', strong ? 'bg-fill-2' : 'bg-fill', className)}
    />
  );
}

/** Highlight sweeping left to right over a skeleton container (design: 1.5 s loop). */
export function Shimmer() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-shimmer to-transparent"
    />
  );
}
