import type { TransactionParams, TypeBucket } from "./wire";

/** The filter set the user picks on the transactions list, which is also what
 *  its query key is built from. Pagination belongs to the infinite query. */
export type TransactionFilterQuery = {
  search?: string;
  accountId?: string;
  bucket?: TypeBucket;
  from?: string;
  to?: string;
  /** Several ids mean *either* of them (OR), server-side. */
  categoryIds?: string[];
  /** Several ids mean *all* of them (AND), server-side. */
  tagIds?: string[];
  uncategorized?: boolean;
  needsReview?: boolean;
  /** Internal transfers are hidden unless this is set — the only filter here
   *  whose absence means *less* than everything. */
  includeTransfers?: boolean;
};

/** The one place a transaction filter becomes request fields, shared by the
 *  list, the counts and the bulk write so "select all shown" writes exactly the
 *  rows the list shows. Values are typed for the JSON bulk body (booleans must
 *  be real booleans there: serde_json will not coerce "true"); the query-string
 *  readers stringify them.
 *
 *  An empty value is omitted rather than sent blank: the server reads a blank
 *  list as "no filter", but an omitted one keeps the request — and the cache —
 *  from splitting. Ids stay comma-joined strings, which is what the server's
 *  `parse_ids` reads in both places. */
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

/** The same fields as a query string, for the GET readers. */
export function transactionFilterParams(q: TransactionFilterQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(transactionFilterFields(q))) params.set(k, String(v));
  return params;
}
