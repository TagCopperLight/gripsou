/** Text colour of a signed figure: green above zero, red below, plain at zero. */
export function toneClass(value: number | string): string {
  const n = Number(value);
  if (n > 0) return "text-green";
  if (n < 0) return "text-red";
  return "text-fg";
}

/** The same tone, muted: for the unit that trails a figure ("/yr"). */
export function mutedToneClass(value: number | string): string {
  const n = Number(value);
  if (n > 0) return "text-green/55";
  if (n < 0) return "text-red/55";
  return "text-fg-faint";
}
