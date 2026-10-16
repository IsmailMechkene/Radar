import { useEffect, useState } from 'react';
import { clampScore, RING_SIZES, RING_STROKE_VAR, ringTone, type RingSize } from './lib/ring';

const COUNT_UP_MS = 600;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Counts from 0 to `target` with an ease-out curve (design: 600 ms). */
function useCountUp(target: number, animate: boolean): number {
  const [enabled] = useState(() => animate && !prefersReducedMotion());
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);
  return enabled ? value : target;
}

interface ScoreRingProps {
  score: number;
  size?: RingSize;
  /** Count up and draw the stroke on mount. Off for table rows. */
  animate?: boolean;
}

/** Score ring: the only colorful element in a table row. Green >= 75, amber >= 55, gray below. */
export function ScoreRing({ score, size = 'sm', animate = false }: ScoreRingProps) {
  const s = clampScore(score);
  const spec = RING_SIZES[size];
  const shown = useCountUp(s, animate);
  return (
    <div
      role="img"
      aria-label={`Score ${s} of 100`}
      className="relative shrink-0"
      style={{ width: spec.px, height: spec.px }}
    >
      <svg
        width={spec.px}
        height={spec.px}
        viewBox="0 0 40 40"
        className="block -rotate-90"
        aria-hidden="true"
      >
        <circle cx="20" cy="20" r="17" fill="none" stroke="var(--fl2)" strokeWidth={spec.stroke} />
        <circle
          cx="20"
          cy="20"
          r="17"
          fill="none"
          pathLength={100}
          stroke={RING_STROKE_VAR[ringTone(s)]}
          strokeWidth={spec.stroke}
          strokeLinecap="round"
          strokeDasharray={`${shown} 100`}
        />
      </svg>
      <div
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center font-semibold tabular-nums"
        style={{ fontSize: spec.fontPx }}
      >
        {shown}
      </div>
    </div>
  );
}
