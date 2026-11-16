import i18n from "../i18n";
import type { UserPrefs } from "../api/wire";
import { getPrefs } from "./prefs";

const PATTERN_TOKEN = /YYYY|YY|MM|DD/g;

/** Replaces each token of a date pattern. */
export function fillPattern(pattern: string, token: (name: string) => string): string {
  return pattern.replace(PATTERN_TOKEN, token);
}

export type DateFormatOptions = {
  /** Tokens YYYY, YY, MM, DD. */
  pattern?: string;
  timeZone?: string;
  prefs?: UserPrefs;
};

export function formatDate(
  value: Date | number | string,
  options: DateFormatOptions = {},
): string {
  const prefs = options.prefs ?? getPrefs();
  const pattern = options.pattern ?? prefs.dateFormat;
  const day = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : zonedDay(value, options.timeZone ?? prefs.timeZone);
  const [year, month, date] = day.split("-");
  const tokens: Record<string, string> = {
    YYYY: year, YY: year.slice(-2), MM: month, DD: date,
  };
  return fillPattern(pattern, (token) => tokens[token]);
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Typed text in `pattern` to an ISO day, or null when it doesn't match or isn't a real date. */
export function parseDate(text: string, pattern: string): string | null {
  const order: string[] = [];
  const source = pattern
    .split(new RegExp(`(${PATTERN_TOKEN.source})`))
    .map((piece, i) => {
      if (i % 2 === 0) return escapeRegex(piece);
      order.push(piece);
      return piece === "YYYY" ? "(\\d{4})" : "(\\d{2})";
    })
    .join("");
  const match = new RegExp(`^${source}$`).exec(text.trim());
  if (!match) return null;
  const part = (token: string) => {
    const at = order.indexOf(token);
    return at < 0 ? undefined : match[at + 1];
  };
  const shortYear = part("YY");
  const year = part("YYYY") ?? (shortYear === undefined ? undefined : `20${shortYear}`);
  const month = part("MM");
  const day = part("DD");
  if (year === undefined || month === undefined || day === undefined) return null;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** null → "Never synced". Past two weeks, an absolute date. */
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

export function zonedDay(value: Date | number | string = new Date(), timeZone = getPrefs().timeZone): string {
  const d = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** UTC-midnight epoch ms: labels, not instants to shift into the viewer's timezone. */
export function calendarDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function formatDay(value: number): string {
  return formatDate(calendarDay(value));
}
