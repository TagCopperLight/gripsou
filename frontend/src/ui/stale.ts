/** Classes for data that a change of the user's (a range, a period, a filter,
 *  a search) has made out of date while its replacement loads: the old data
 *  stays, dimmed. Pass a query's `isPlaceholderData`, which is true exactly
 *  then, and not for a refetch in the background. Only the data dims: titles,
 *  labels, column headers and controls keep full strength. */
export function staleClass(stale: boolean): string {
  // Dims after `--loading-delay` (a fast answer dims nothing), brightens at once.
  return `transition-opacity duration-200 ${stale ? "opacity-40 delay-(--loading-delay)" : ""}`;
}

/** `staleClass` for a `GridTable`'s body rows, set on the table: its `<tbody>`
 *  is `display: contents`, where opacity does nothing. Tailwind only generates
 *  classes spelled whole in the source, so these can't be built from
 *  `staleClass`'s by prefixing them, and keep its values beside it here. */
export function staleRowsClass(stale: boolean): string {
  return `[&>tbody>tr]:transition-opacity [&>tbody>tr]:duration-200 ${stale ? "[&>tbody>tr]:opacity-40 [&>tbody>tr]:delay-(--loading-delay)" : ""}`;
}
