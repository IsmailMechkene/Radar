import type { LucideIcon } from 'lucide-react';

/** Icon sizes used by the design (px). */
export type IconSize = 11 | 12 | 13 | 14 | 15 | 16 | 18 | 22;

interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  /** Design default is a thin 1.5 stroke; 2 inside settings tiles, 3 for check marks. */
  stroke?: 1.5 | 2 | 3;
  className?: string;
  fill?: string;
}

/** Lucide icon with the design defaults. Decorative: hidden from assistive tech. */
export function Icon({ icon: Glyph, size = 16, stroke = 1.5, className, fill }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={stroke}
      className={className}
      fill={fill ?? 'none'}
      aria-hidden="true"
      focusable="false"
    />
  );
}
