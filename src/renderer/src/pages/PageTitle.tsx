/** Page heading as in the design: 30/600, -0.025 em, line-height 1.1; 13 px secondary subtitle. */
export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="m-0 text-title-1 font-semibold tracking-title-1">{title}</h1>
      {subtitle && <div className="mt-1.5 text-body text-fg-2">{subtitle}</div>}
    </div>
  );
}
