// The account palette is shared with the backend, which gives an imported
// account a random colour from it. `account.color` stores the chosen hex
// verbatim.
import ACCOUNT_PALETTE from "../../../shared/account-palette.json";

export { ACCOUNT_PALETTE };

const [blue, teal, purple, gold, pink, olive, orange, steel, lavender, mint] = ACCOUNT_PALETTE;

export { mint as MINT, orange as ORANGE };

/** The category and tag swatches: the account palette's hues plus enough
 *  others to fill one row, ordered around the colour wheel. */
export const BUDGET_PALETTE: readonly string[] = [
  "#e0605f",
  orange,
  gold,
  "#c9a26b",
  "#8fd05f",
  olive,
  mint,
  teal,
  "#55c2d8",
  blue,
  steel,
  "#7f8cf0",
  lavender,
  purple,
  "#d97ec4",
  pink,
  "#9aa4b2",
];

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
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return hslToHex(h, 65, 60);
}
