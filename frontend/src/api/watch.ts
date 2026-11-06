import { hashKey, type QueryClient, type QueryKey } from "@tanstack/react-query";

const watched = new WeakMap<QueryClient, Set<string>>();

/** Calls `onChange` with the data before and after each successful fetch of
 *  one polled query, to act when a background run moves on. Installed once
 *  per client and key, whichever component asks first. The first read has
 *  nothing to compare to; a removed query starts over. */
export function watchQuery<T>(
  qc: QueryClient,
  queryKey: QueryKey,
  onChange: (prev: T, next: T) => void,
) {
  const hash = hashKey(queryKey);
  const installed = watched.get(qc) ?? new Set<string>();
  watched.set(qc, installed);
  if (installed.has(hash)) return;
  installed.add(hash);
  let last = qc.getQueryData<T>(queryKey);
  qc.getQueryCache().subscribe((event) => {
    if (event.query.queryHash !== hash) return;
    if (event.type === "removed") {
      last = undefined;
      return;
    }
    if (event.type !== "updated" || event.action.type !== "success") return;
    const next = event.query.state.data as T | undefined;
    const prev = last;
    last = next;
    if (prev !== undefined && next !== undefined) onChange(prev, next);
  });
}
