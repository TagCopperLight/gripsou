type LegendItem = {
  label: string;
  /** Any CSS color, e.g. "var(--color-green)". */
  color: string;
  /** Render the marker as a dotted line instead of a solid one. */
  dashed?: boolean;
};

type ChartLegendProps = {
  items: LegendItem[];
  className?: string;
};

export function ChartLegend({ items, className = "" }: ChartLegendProps) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {items.map((item) => (
        <div key={item.label} className="flex shrink-0 items-center gap-2">
          <span
            className="w-4"
            style={
              item.dashed
                ? { borderTop: `2px dotted ${item.color}` }
                : { height: 2, borderRadius: 9999, background: item.color }
            }
          />
          <span className="whitespace-nowrap text-fg-faint text-xs font-mono">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
