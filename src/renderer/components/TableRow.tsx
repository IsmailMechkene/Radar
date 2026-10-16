import type { ReactNode } from 'react';
import { cn } from './lib/cn';

interface TableRowProps {
  /** CSS grid-template-columns for the row's cells. */
  columns: string;
  selected?: boolean;
  /** Forces the hover look (for the Components page). */
  hovered?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

/**
 * 56 px table row, hairline separator on top, no zebra striping.
 * Hover: fill. Selected: accent-soft. Only the score ring carries color.
 */
export function TableRow({ columns, selected, hovered, onClick, children }: TableRowProps) {
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={onClick}
      style={{ gridTemplateColumns: columns }}
      className={cn(
        'grid h-14 items-center gap-x-3 px-5.5 hairline-t border-line',
        'transition-colors duration-(--duration-base) ease-out',
        selected ? 'bg-accent-soft' : hovered ? 'bg-fill' : 'hover:bg-fill',
      )}
    >
      {children}
    </div>
  );
}

/** Two-line cell: title (13/600) over a tertiary reason line with a secondary lead. */
export function RowTitle({ title, lead, detail }: { title: string; lead: string; detail: string }) {
  return (
    <div role="cell" className="min-w-0">
      <div className="truncate text-body font-semibold">{title}</div>
      <div className="truncate text-footnote text-fg-3">
        <span className="text-fg-2">{lead}</span> · {detail}
      </div>
    </div>
  );
}
