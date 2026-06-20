// Fixed account-color palette shown as swatches in the edit-account modal and
// used by the backend to assign a random color on import. Single source of
// truth: shared/account-palette.json at the repo root. `account.color` stores
// the chosen hex verbatim.
import ACCOUNT_PALETTE from "../../../shared/account-palette.json";

export { ACCOUNT_PALETTE };

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
