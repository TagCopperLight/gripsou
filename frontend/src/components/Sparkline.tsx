import { useId } from "react";

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
};

export function Sparkline({
  data,
  width = 96,
  height = 32,
  className = "",
}: SparklineProps) {
  const gradientId = useId();
  // The colour is the window's own direction and nothing else: green when this
  // month ended above where it started, red otherwise. Deliberately NOT the
  // holding's all-time gain — a position bought two years ago and still under
  // water can have had a good month, and this chart is about the month.
  const last = data.at(-1) ?? 0;
  const stroke =
    last >= (data[0] ?? 0) ? "var(--color-green)" : "var(--color-red)";
  const pad = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const coords = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = pad + (1 - (v - min) / span) * (height - 2 * pad);
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} ${width},${height} 0,${height}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} stroke="none" />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
