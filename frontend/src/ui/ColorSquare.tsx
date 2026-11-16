export function ColorSquare({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: color }} />;
}
