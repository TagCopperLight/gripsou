import i18n from "../i18n";
import { getPrefs } from "./prefs";

export type DateFormatOptions = {
  /** Token pattern. Supports YYYY, YY, MM, DD. Defaults to the user's prefs. */
  pattern?: string;
  timeZone?: string;
};

export function formatDate(
  value: Date | number | string,
  options: DateFormatOptions = {},
): string {
  const pattern = options.pattern ?? getPrefs().dateFormat;
  const day = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : zonedDay(value, options.timeZone);
  const [year, month, date] = day.split("-");
  const tokens: Record<string, string> = {
    YYYY: year, YY: year.slice(-2), MM: month, DD: date,
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
  if (value === null) return i18n.t("sync.neverSynced");
  const diff = Date.now() - value;
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  if (diff < MIN) return i18n.t("time.justNow");
  if (diff < HOUR) return i18n.t("time.minAgo", { count: Math.floor(diff / MIN) });
  if (diff < DAY) return i18n.t("time.hAgo", { count: Math.floor(diff / HOUR) });
  const days = Math.floor(diff / DAY);
  if (days === 1) return i18n.t("time.yesterday");
  if (days < 7) return i18n.t("time.daysAgo", { count: days });
  if (days < 14) return i18n.t("time.lastWeek");
  return formatDate(value, options);
}

/** Calendar day of a real instant in the user's saved timezone. */
export function zonedDay(value: Date | number | string = new Date(), timeZone = getPrefs().timeZone): string {
  const d = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** API calendar dates are encoded as UTC-midnight epoch milliseconds.
 * They are labels, not instants to shift into the viewer's timezone. */
export function calendarDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function formatDay(value: number): string {
  return formatDate(calendarDay(value));
}
