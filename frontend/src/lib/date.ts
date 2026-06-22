import i18n from "../i18n";
import { getPrefs } from "./prefs";

export type DateFormatOptions = {
  /** Token pattern. Supports YYYY, YY, MM, DD. Defaults to the user's prefs. */
  pattern?: string;
};

export function formatDate(
  value: Date | number | string,
  options: DateFormatOptions = {},
): string {
  const pattern = options.pattern ?? getPrefs().dateFormat;
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
