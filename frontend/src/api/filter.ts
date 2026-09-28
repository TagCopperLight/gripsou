import type { TransactionFilterQuery } from "./types";

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
export function transactionFilterFields(
  q: TransactionFilterQuery,
): Record<string, string | boolean> {
  const f: Record<string, string | boolean> = {};
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
