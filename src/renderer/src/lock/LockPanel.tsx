import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { cn } from '../../components/lib/cn';
import { LOGIN_TIPS, nextTip, TIP_INTERVAL_MS } from '../lib/lock';

/**
 * Radar's icon as a stack of tiles seen at an isometric angle: two frosted layers stepping back
 * and the blue app tile on top (ring and centre dot, as in BrandMark).
 */
function IconStack() {
  const layer = 'absolute inset-0 rounded-icon';
  return (
    <div
      aria-hidden="true"
      className="absolute bottom-[20%] left-1/2 size-30 -translate-x-1/2 translate-y-1/2 perspective-distant"
    >
      <div className="relative size-full transform-3d rotate-x-58 rotate-z-45">
        <div
          className={cn(layer, 'translate-2.5 bg-glass hairline border-glass-border shadow-pop')}
        />
        <div className={cn(layer, 'translate-1.25 bg-surface-2 hairline border-line')} />
        <div
          className={cn(
            layer,
            'grid place-items-center bg-linear-135 from-(--brand-from) to-(--brand-to)',
          )}
        >
          <div className="grid size-14.5 place-items-center rounded-full border-5 border-(--brand-ring)">
            <div className="size-4 rounded-full bg-on-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One tip at a time as the panel's headline, with a dot per tip and Next tip. It rotates by
 * itself (paused while the pointer or focus is on it).
 */
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
      className="relative flex flex-col items-center px-14 pt-16 text-center"
    >
      <div className="text-caption-2 font-semibold tracking-caps text-fg-3 uppercase">
        Did you know?
      </div>
      <p
        key={index}
        aria-live="polite"
        className="mt-3.5 min-h-18 max-w-80 text-title-3 leading-snug font-semibold tracking-title-3 text-balance animate-fade-in"
      >
        {LOGIN_TIPS[index]}
      </p>
      <div className="mt-6 flex items-center gap-3.5">
        <div className="flex gap-1.25">
          {LOGIN_TIPS.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Tip ${i + 1}`}
              aria-current={i === index || undefined}
              onClick={() => setIndex(i)}
              className={cn(
                'focus-ring size-1.5 rounded-full transition-colors duration-(--duration-fast)',
                i === index ? 'bg-fg-2' : 'bg-line-2',
              )}
            />
          ))}
        </div>
        <Button
          variant="plain"
          size="sm"
          iconRight={ChevronRight}
          onClick={() => setIndex((i) => nextTip(i))}
        >
          Next tip
        </Button>
      </div>
    </section>
  );
}

/**
 * Right side of the login window: a quiet surface with a tip at the top, soft colored light
 * rising from the bottom edge (five blurred blobs, `.login-blobs` in tokens.css) and Radar's icon
 * floating in it.
 */
export function LockPanel() {
  return (
    <aside className="relative size-full overflow-hidden rounded-2xl bg-surface-2 hairline border-line">
      <div aria-hidden="true" className="login-blobs absolute inset-x-0 bottom-0 h-[62%]">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <IconStack />
      <Tip />
    </aside>
  );
}
