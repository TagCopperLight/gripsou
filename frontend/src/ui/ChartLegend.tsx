type LegendItem = {
  label: string;
  /** Any CSS color. None: no marker (a "+3 others"). */
  color?: string;
  dashed?: boolean;
  key?: string;
  title?: string;
};

type ChartLegendProps = {
  items: LegendItem[];
  onHover?: (key: string | null) => void;
  className?: string;
};

export function ChartLegend({ items, onHover, className = "" }: ChartLegendProps) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {items.map((item) => (
        <div
          key={item.key ?? item.label}
          title={item.title ?? item.label}
          onMouseEnter={onHover && item.color ? () => onHover(item.key ?? item.label) : undefined}
          onMouseLeave={onHover && item.color ? () => onHover(null) : undefined}
          className="flex min-w-0 shrink-0 items-center gap-2"
        >
          {item.color && (
            <span
              className="w-4"
              style={
                item.dashed
                  ? { borderTop: `2px dotted ${item.color}` }
                  : { height: 2, borderRadius: 9999, background: item.color }
              }
            />
          )}
          <span className="max-w-48 truncate whitespace-nowrap text-fg-faint text-xs font-mono">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
