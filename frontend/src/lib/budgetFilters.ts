import type { TransactionFilterQuery, TypeBucket } from "../api/types";
import { presetRange, type Period } from "./period";

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
  /** Internal transfers are hidden until this is on — they are money moving
   *  between the user's own accounts, not spending. Unlike every other flag
   *  here, `false` narrows the list rather than widening it. */
  transfers: boolean;
  /** Set only by Overview's deep links; renders as a "Selected period" chip
   *  (labelled at render time, so it follows a language switch) and is
   *  cleared together with the dates it stands for. */
  period?: Period;
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
  transfers: false,
};

export function withTimeFrame(
  f: BudgetFilters,
  timeFrame: TimeFrame,
  today: Date = new Date(),
): BudgetFilters {
  // Picking any time frame here supersedes Overview's "Selected period" chip:
  // leaving `period` set would keep showing the OLD period's label
  // while `activeFilters` hides the real time-frame chip underneath it.
  if (timeFrame === "custom") return { ...f, timeFrame, period: undefined };
  if (timeFrame === "all") return { ...f, timeFrame, from: "", to: "", period: undefined };
  return { ...f, timeFrame, ...presetRange(timeFrame, today), period: undefined };
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
  if (f.transfers) q.includeTransfers = true;
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
  | { kind: "needsReview" }
  | { kind: "transfers" };

/** Part 3 of the search surface: one chip per active filter, account and time
 *  frame included. Order is the reading order of the controls above. */
export function activeFilters(f: BudgetFilters): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (f.period) out.push({ kind: "period" });
  if (f.search.trim()) out.push({ kind: "search", value: f.search.trim() });
  if (f.accountId) out.push({ kind: "account", id: f.accountId });
  if (!f.period && f.timeFrame !== "all" && (f.from || f.to)) out.push({ kind: "timeFrame" });
  if (f.bucket !== "all") out.push({ kind: "bucket", value: f.bucket });
  for (const id of f.categoryIds) out.push({ kind: "category", id });
  for (const id of f.tagIds) out.push({ kind: "tag", id });
  if (f.uncategorized) out.push({ kind: "uncategorized" });
  if (f.needsReview) out.push({ kind: "needsReview" });
  if (f.transfers) out.push({ kind: "transfers" });
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
      return { ...f, period: undefined, from: "", to: "", timeFrame: "all" };
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
    case "transfers":
      return { ...f, transfers: false };
  }
}
