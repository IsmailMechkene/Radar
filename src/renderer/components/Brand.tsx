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

/** Google's "G" for Continue with Google (brand colors from tokens). Decorative. */
export function GoogleMark({ size = 14 }: { size?: 14 | 16 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" focusable="false">
      <path
        fill="var(--google-red)"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="var(--google-blue)"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="var(--google-yellow)"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="var(--google-green)"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
