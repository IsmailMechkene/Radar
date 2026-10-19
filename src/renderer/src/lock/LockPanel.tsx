import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { cn } from '../../components/lib/cn';
import { LOGIN_TIPS, nextTip, TIP_INTERVAL_MS } from '../lib/lock';

/**
 * Radar's icon as a stack of glass tiles seen at an isometric angle: two frosted layers and the
 * blue app tile on top (ring and centre dot, as in BrandMark).
 */
function IconStack() {
  const layer = 'absolute inset-0 rounded-icon';
  return (
    <div aria-hidden="true" className="relative size-24 perspective-distant">
      {/* Contact shadow on the "floor". */}
      <div className="absolute inset-x-2 -bottom-5 h-6 rounded-full bg-dim blur-md" />
      <div className="relative size-full transform-3d rotate-x-55 rotate-z-45">
        <div className={cn(layer, 'bg-glass hairline border-glass-border opacity-60')} />
        <div
          className={cn(
            layer,
            'translate-z-3 bg-glass hairline border-glass-border shadow-card backdrop-glass',
          )}
        />
        <div
          className={cn(
            layer,
            'grid translate-z-6 place-items-center bg-linear-to-b from-(--brand-from) to-(--brand-to) shadow-pop',
          )}
        >
          <div className="grid size-12 place-items-center rounded-full border-4 border-(--brand-ring)">
            <div className="size-3 rounded-full bg-on-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** One tip at a time as the panel's headline; it rotates by itself, and Next skips ahead. */
function Tip() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setIndex((i) => nextTip(i)), TIP_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [index, paused]);

  return (
    <section
      aria-label="Did you know?"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="flex flex-col items-center px-10 text-center"
    >
      <div className="text-caption-2 font-semibold tracking-caps text-fg-3 uppercase">
        Did you know?
      </div>
      <p
        key={index}
        aria-live="polite"
        className="mt-3 min-h-26 max-w-90 text-title-3 leading-snug font-semibold tracking-title-3 text-balance animate-fade-in"
      >
        {LOGIN_TIPS[index]}
      </p>
      <Button
        variant="plain"
        size="sm"
        iconRight={ChevronRight}
        onClick={() => setIndex((i) => nextTip(i))}
        className="mt-1"
      >
        Next tip
      </Button>
    </section>
  );
}

/**
 * Right side of the login window: a quiet surface with a tip at the top, Radar's icon floating
 * low, and a soft multicolor glow rising from the bottom edge.
 */
export function LockPanel() {
  return (
    <aside className="relative mt-(--lock-titlebar-height) mr-3 mb-3 flex w-(--lock-panel-width) shrink-0 flex-col items-center overflow-hidden rounded-3xl bg-surface-2 hairline border-line">
      {/* A circle wider than the panel, centred below it: only its top arc shows. */}
      <div
        aria-hidden="true"
        className="absolute bottom-(--glow-bottom) left-1/2 aspect-square w-(--glow-size) -translate-x-1/2 opacity-(--glow-opacity) blur-(--blur-glow) saturate-150"
      >
        <div className="size-full login-glow motion-safe:animate-glow-drift" />
      </div>
      <div className="relative flex flex-1 flex-col items-center justify-between pt-16 pb-24">
        <Tip />
        <IconStack />
      </div>
    </aside>
  );
}
