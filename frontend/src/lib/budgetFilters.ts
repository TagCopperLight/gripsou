import type { TransactionFilterQuery, TypeBucket } from "../api/types";

/** The presets the time-frame select offers. `custom` keeps whatever dates the
 *  user typed; `all` means no date bound at all. */
export const TIME_FRAMES = [
  "all",
  "thisMonth",
  "last3Months",
  "thisYear",
  "last12Months",
  "custom",
] as const;

export type TimeFrame = (typeof TIME_FRAMES)[number];

/** What the user picked. It is deliberately not the wire shape: `timeFrame`
 *  exists only so the select can show which preset produced `from`/`to`. */
export type BudgetFilters = {
  search: string;
  accountId: string;
  bucket: TypeBucket;
  timeFrame: TimeFrame;
  from: string;
  to: string;
  categoryIds: string[];
  tagIds: string[];
  uncategorized: boolean;
  needsReview: boolean;
  /** Set only by Overview's deep links (phase 4); renders as a "Selected
   *  period" chip and is cleared together with the dates it stands for. */
  periodLabel?: string;
};

export const EMPTY_FILTERS: BudgetFilters = {
  search: "",
  accountId: "",
  bucket: "all",
  timeFrame: "all",
  from: "",
  to: "",
  categoryIds: [],
  tagIds: [],
  uncategorized: false,
  needsReview: false,
};

/** Local calendar day as `YYYY-MM-DD`. `toISOString()` is wrong here: it
 *  converts to UTC first, which shifts the day for anyone east or west of it. */
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** `d` shifted back `months` months, with the day clamped to the target
 *  month's length. Without the clamp the Date constructor silently rolls
 *  over — 29 Feb minus 12 months would land on 1 March. */
function monthsBack(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth();
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(y, m - months + 1, 0).getDate();
  return new Date(y, m - months, Math.min(d.getDate(), lastDay));
}

export function withTimeFrame(
  f: BudgetFilters,
  timeFrame: TimeFrame,
  today: Date = new Date(),
): BudgetFilters {
  if (timeFrame === "custom") return { ...f, timeFrame };
  if (timeFrame === "all") return { ...f, timeFrame, from: "", to: "" };

  const y = today.getFullYear();
  const m = today.getMonth();
  const ranges: Record<Exclude<TimeFrame, "all" | "custom">, [Date, Date]> = {
    thisMonth: [new Date(y, m, 1), new Date(y, m + 1, 0)],
    last3Months: [new Date(y, m - 2, 1), new Date(y, m + 1, 0)],
    thisYear: [new Date(y, 0, 1), new Date(y, 11, 31)],
    last12Months: [monthsBack(today, 12), today],
  };
  const [from, to] = ranges[timeFrame];
  return { ...f, timeFrame, from: isoDay(from), to: isoDay(to) };
}

/** The filter set as the API reads it. Empty values are omitted so the query
 *  key stays minimal and two equivalent filter sets share one cache entry. */
export function toQuery(f: BudgetFilters): TransactionFilterQuery {
  const q: TransactionFilterQuery = {};
  if (f.search.trim()) q.search = f.search.trim();
  if (f.accountId) q.accountId = f.accountId;
  if (f.bucket !== "all") q.bucket = f.bucket;
  if (f.from) q.from = f.from;
  if (f.to) q.to = f.to;
  if (f.categoryIds.length) q.categoryIds = f.categoryIds;
  if (f.tagIds.length) q.tagIds = f.tagIds;
  if (f.uncategorized) q.uncategorized = true;
  if (f.needsReview) q.needsReview = true;
  return q;
}

export type ActiveFilter =
  | { kind: "search"; value: string }
  | { kind: "account"; id: string }
  | { kind: "timeFrame" }
  | { kind: "period" }
  | { kind: "bucket"; value: TypeBucket }
  | { kind: "category"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "uncategorized" }
  | { kind: "needsReview" };

/** Part 3 of the search surface: one chip per active filter, account and time
 *  frame included (§2.2). Order is the reading order of the controls above. */
export function activeFilters(f: BudgetFilters): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (f.periodLabel) out.push({ kind: "period" });
  if (f.search.trim()) out.push({ kind: "search", value: f.search.trim() });
  if (f.accountId) out.push({ kind: "account", id: f.accountId });
  if (!f.periodLabel && f.timeFrame !== "all" && (f.from || f.to)) out.push({ kind: "timeFrame" });
  if (f.bucket !== "all") out.push({ kind: "bucket", value: f.bucket });
  for (const id of f.categoryIds) out.push({ kind: "category", id });
  for (const id of f.tagIds) out.push({ kind: "tag", id });
  if (f.uncategorized) out.push({ kind: "uncategorized" });
  if (f.needsReview) out.push({ kind: "needsReview" });
  return out;
}

export function isFiltered(f: BudgetFilters): boolean {
  return activeFilters(f).length > 0;
}

export function clearFilter(f: BudgetFilters, a: ActiveFilter): BudgetFilters {
  switch (a.kind) {
    case "search":
      return { ...f, search: "" };
    case "account":
      return { ...f, accountId: "" };
    case "timeFrame":
      return { ...f, timeFrame: "all", from: "", to: "" };
    case "period":
      return { ...f, periodLabel: undefined, from: "", to: "", timeFrame: "all" };
    case "bucket":
      return { ...f, bucket: "all" };
    case "category":
      return { ...f, categoryIds: f.categoryIds.filter((id) => id !== a.id) };
    case "tag":
      return { ...f, tagIds: f.tagIds.filter((id) => id !== a.id) };
    case "uncategorized":
      return { ...f, uncategorized: false };
    case "needsReview":
      return { ...f, needsReview: false };
  }
}
