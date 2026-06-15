export type DateFormatOptions = {
  /** Token pattern. Supports YYYY, YY, MM, DD. */
  pattern?: string;
};

const DEFAULTS: Required<DateFormatOptions> = {
  pattern: "DD/MM/YYYY",
};

export function formatDate(
  value: Date | number | string,
  options: DateFormatOptions = {},
): string {
  const { pattern } = { ...DEFAULTS, ...options };
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: pad(d.getFullYear() % 100),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
  };
  return pattern.replace(/YYYY|YY|MM|DD/g, (token) => tokens[token]);
}

/**
 * Human "time ago" for sync timestamps. null → "Never synced". Past two weeks,
 * falls back to an absolute date via formatDate (so date prefs still apply).
 */
export function formatRelative(
  value: number | null,
  options: DateFormatOptions = {},
): string {
  if (value === null) return "Never synced";
  const diff = Date.now() - value;
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 14) return "last week";
  return formatDate(value, options);
}
