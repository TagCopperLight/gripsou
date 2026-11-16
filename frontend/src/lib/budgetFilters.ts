import type { TypeBucket } from "../api/wire";
import type { TransactionFilterQuery } from "../api/filter";
import { presetRange, type Period } from "./period";

export const TIME_FRAMES = [
  "all",
  "thisMonth",
  "last3Months",
  "thisYear",
  "last12Months",
  "custom",
] as const;

export type TimeFrame = (typeof TIME_FRAMES)[number];

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
  /** Unlike every other flag here, `false` narrows the list rather than widening it. */
  transfers: boolean;
  /** Labelled at render time, so it follows a language switch; cleared together with the dates it stands for. */
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
  // Leaving `period` set would keep the old period's label while `activeFilters` hides the real time-frame chip.
  if (timeFrame === "custom") return { ...f, timeFrame, period: undefined };
  if (timeFrame === "all") return { ...f, timeFrame, from: "", to: "", period: undefined };
  return { ...f, timeFrame, ...presetRange(timeFrame, today), period: undefined };
}

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
