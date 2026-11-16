import type { TransactionParams, TypeBucket } from "./wire";

export type TransactionFilterQuery = {
  search?: string;
  accountId?: string;
  bucket?: TypeBucket;
  from?: string;
  to?: string;
  /** Several ids: any of them. */
  categoryIds?: string[];
  /** Several ids: all of them. */
  tagIds?: string[];
  uncategorized?: boolean;
  needsReview?: boolean;
  /** Hidden unless set: the only filter whose absence means less than everything. */
  includeTransfers?: boolean;
};

/** Shared by the list, counts and bulk write so "select all shown" writes exactly the shown rows.
 *  Booleans stay real booleans (the JSON bulk body rejects "true"). Empty values are omitted so the
 *  request and its cache key don't split. */
export function transactionFilterFields(q: TransactionFilterQuery): TransactionParams {
  const f: TransactionParams = {};
  if (q.search) f.search = q.search;
  if (q.accountId) f.accountId = q.accountId;
  if (q.bucket && q.bucket !== "all") f.bucket = q.bucket;
  if (q.from) f.from = q.from;
  if (q.to) f.to = q.to;
  if (q.categoryIds?.length) f.categoryIds = q.categoryIds.join(",");
  if (q.tagIds?.length) f.tagIds = q.tagIds.join(",");
  if (q.uncategorized) f.uncategorized = true;
  if (q.needsReview) f.needsReview = true;
  if (q.includeTransfers) f.includeTransfers = true;
  return f;
}
