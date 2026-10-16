import { cn } from './lib/cn';

/** Per-organisation monogram tile (design `mono()`): white initials on oklch(L C hue). */
export function OrgAvatar({
  initials,
  hue,
  size = 'sm',
}: {
  initials: string;
  hue: number;
  /** xs 28 px (pipeline rows), sm 32 px (strip cards), md 36 px (drawer header). */
  size?: 'xs' | 'sm' | 'md';
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center font-semibold text-on-accent',
        size === 'xs' && 'size-7 rounded-sm text-micro',
        size === 'sm' && 'size-8 rounded-md text-footnote',
        size === 'md' && 'size-9 rounded-md text-body',
      )}
      style={{ background: `oklch(var(--monogram-l) var(--monogram-c) ${hue})` }}
    >
      {initials}
    </div>
  );
}

/** Radar app mark: blue gradient tile with a ring and centre dot. sm 26 px (sidebar), lg 52 px (dialogs). */
export function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <div
      aria-hidden="true"
      className={cn(
        'grid place-items-center bg-linear-to-b from-(--brand-from) to-(--brand-to) shadow-brand',
        lg ? 'size-13 rounded-2xl' : 'size-6.5 rounded-sm',
      )}
    >
      <div
        className={cn(
          'grid place-items-center rounded-full border-(--brand-ring)',
          lg
            ? 'size-6.5 border-(length:--border-brand-lg)'
            : 'size-3.5 border-(length:--border-brand)',
        )}
      >
        <div className={cn('rounded-full bg-on-accent', lg ? 'size-1.75' : 'size-1')} />
      </div>
    </div>
  );
}
