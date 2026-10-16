import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from './lib/cn';

interface TableRowProps extends HTMLAttributes<HTMLDivElement> {
  /** CSS grid-template-columns for the row's cells. */
  columns: string;
  selected?: boolean;
  /** Keyboard cursor (j/k) or forced hover look (Components page): fill background. */
  hovered?: boolean;
  /** Side padding: md 22 px (cards), sm 16 px (the Opportunities table). */
  inset?: 'sm' | 'md';
  children: ReactNode;
}

/**
 * 56 px table row, hairline separator on top, no zebra striping.
 * Hover / cursor: fill. Selected (checked or open in the drawer): accent-soft.
 * Only the score ring carries color.
 */
export const TableRow = forwardRef<HTMLDivElement, TableRowProps>(function TableRow(
  { columns, selected, hovered, inset = 'md', children, className, style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="row"
      aria-selected={selected}
      style={{ gridTemplateColumns: columns, ...style }}
      className={cn(
        'grid h-14 items-center gap-x-3 hairline-t border-line outline-none',
        inset === 'sm' ? 'px-4' : 'px-5.5',
        'transition-colors duration-(--duration-fast) ease-out',
        selected ? 'bg-accent-soft' : hovered ? 'bg-fill' : 'hover:bg-fill',
        'focus-visible:shadow-[inset_0_0_0_2px_var(--ac)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

/** Two-line cell: title (13/600) over a tertiary reason line with a secondary lead. */
export function RowTitle({ title, lead, detail }: { title: string; lead: string; detail: string }) {
  return (
    <div role="cell" className="min-w-0">
      <div className="truncate text-body font-semibold">{title}</div>
      <div className="mt-0.5 truncate text-footnote text-fg-3">
        <span className="text-fg-2">{lead}</span>
        {detail && ` · ${detail}`}
      </div>
    </div>
  );
}
