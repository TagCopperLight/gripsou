// Fixed account-color palette shown as swatches in the edit-account modal.
// `account.color` stores the chosen hex verbatim. Order here is display order;
// tweak hexes freely.
export const ACCOUNT_PALETTE = [
  "#5b9bf0", // blue
  "#4dd0b1", // teal
  "#b07ef0", // purple
  "#f0b952", // amber
  "#f08fb0", // pink
  "#9bb06b", // olive
  "#e88a5f", // coral
  "#6aa0e0", // steel
  "#b8a8f0", // lavender
  "#5fcf9e", // green
] as const;

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function colorForString(str: string): string {
  if (str === "EUR") return ACCOUNT_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return hslToHex(h, 65, 60);
}
