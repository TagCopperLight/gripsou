/** Pass a query's `isPlaceholderData`: true only while replacement data loads, not on a background refetch. Only data dims. */
export function staleClass(stale: boolean): string {
  // Dims after `--loading-delay`, brightens at once.
  return `transition-opacity duration-200 ${stale ? "opacity-40 delay-(--loading-delay)" : ""}`;
}

/** For a `GridTable`'s rows: its `<tbody>` is `display: contents`, where opacity does nothing. Spelled whole because Tailwind only generates classes written out in full. */
export function staleRowsClass(stale: boolean): string {
  return `[&>tbody>tr]:transition-opacity [&>tbody>tr]:duration-200 ${stale ? "[&>tbody>tr]:opacity-40 [&>tbody>tr]:delay-(--loading-delay)" : ""}`;
}
