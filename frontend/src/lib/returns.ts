import type { ReturnFigures } from "../api/wire";

export function toneClass(value: number | string): string {
  const n = Number(value);
  if (n > 0) return "text-green";
  if (n < 0) return "text-red";
  return "text-fg";
}

export function mutedToneClass(value: number | string): string {
  const n = Number(value);
  if (n > 0) return "text-green/55";
  if (n < 0) return "text-red/55";
  return "text-fg-faint";
}

export function leavesOut(f: ReturnFigures): boolean {
  return f.excludedHistory + f.excludedRate > 0;
}
