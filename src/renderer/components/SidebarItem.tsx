import type { LucideIcon } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { CountBadge, type CountTone } from './Badge';
import { Icon } from './Icon';
import { cn } from './lib/cn';

interface SidebarItemProps {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  /** `label` is read instead of the short text ("3 follow-ups due" for "3"). */
  badge?: { text: string; tone: CountTone; label?: string };
  onNavigate: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLAnchorElement>) => void;
}

/** 32 px nav item. Active: fill-2 background, semibold label, accent icon. */
export function SidebarItem({
  href,
  label,
  icon,
  active,
  badge,
  onNavigate,
  onKeyDown,
}: SidebarItemProps) {
  return (
    <a
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        onNavigate();
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'focus-ring app-no-drag flex h-8 items-center gap-2.5 rounded-sm px-2.5 text-fg',
        'transition-colors duration-(--duration-fast) ease-out',
        active ? 'bg-fill-2 font-semibold' : 'font-medium hover:bg-fill',
      )}
    >
      <Icon icon={icon} size={16} className={active ? 'text-accent' : 'text-fg-2'} />
      <span className="text-body">{label}</span>
      {badge && (
        <span className="ml-auto" title={badge.label}>
          <span aria-hidden={badge.label ? true : undefined}>
            <CountBadge tone={badge.tone}>{badge.text}</CountBadge>
          </span>
          {badge.label && <span className="sr-only">, {badge.label}</span>}
        </span>
      )}
    </a>
  );
}
