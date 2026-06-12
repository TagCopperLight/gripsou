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
