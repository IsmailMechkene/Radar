// Score ring spec, copied from the design (components screen `ringDemo`, table rows, `rc()`).

export type RingTone = 'green' | 'amber' | 'gray';

/** Design rule: >= 75 green (strong match), >= 55 amber (maybe), otherwise gray. */
export function ringTone(score: number): RingTone {
  if (score >= 75) return 'green';
  if (score >= 55) return 'amber';
  return 'gray';
}

export const RING_STROKE_VAR: Record<RingTone, string> = {
  green: 'var(--grf)',
  amber: 'var(--amf)',
  gray: 'var(--gyf)',
};

export type RingSize = 'xl' | 'lg' | 'md' | 'sm';

/** px = diameter, stroke in the 40-unit viewBox, fontPx = centred number. */
export const RING_SIZES: Record<RingSize, { px: number; stroke: number; fontPx: number }> = {
  xl: { px: 88, stroke: 3.4, fontPx: 24 },
  lg: { px: 64, stroke: 3.4, fontPx: 19 },
  md: { px: 44, stroke: 3.4, fontPx: 14 },
  sm: { px: 32, stroke: 4, fontPx: 11.5 },
};

/** Clamps and rounds a score into 0..100 for display. */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.round(Math.min(100, Math.max(0, score)));
}
