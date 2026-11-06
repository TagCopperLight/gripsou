/** The small square of an account's (or a slice's) colour, before its name. */
export function ColorSquare({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: color }} />;
}
