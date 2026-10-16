import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { cn } from './lib/cn';

interface BannerProps {
  tone?: 'danger' | 'warning';
  title: string;
  description?: string;
  /** Optional trailing action (e.g. a small destructive "Scan now" button). */
  action?: ReactNode;
}

/** Inline banner, radius 10. Danger = red (broken, stale); warning = amber (page changed). */
export function Banner({ tone = 'danger', title, description, action }: BannerProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-2.5',
        tone === 'danger' ? 'bg-red-soft text-red' : 'bg-amber-soft text-amber',
      )}
    >
      <Icon icon={TriangleAlert} size={15} />
      <span className="text-subhead font-semibold">{title}</span>
      {description && <span className="text-subhead text-fg-2">{description}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}
