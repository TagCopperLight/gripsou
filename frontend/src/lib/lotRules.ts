// Imports only wire constants and decimal.ts, so the mock server can use it.

import { LOT_DECIMAL_PLACES, LOT_MAX_INTEGER_DIGITS, type LotSide } from "../api/wire.ts";
import { canonicalDecimal, compareDecimals, multiplyDecimals, negateDecimal, subtractDecimals, sumDecimals } from "./decimal.ts";

/** The backend's `lot_cash_amount` SQL is the same rule, both checked against
 *  `shared/lot-cases.json`. Every screen showing a lot's amount must use this. */
export function lotCashAmount(side: LotSide, qty: string, price: string, fee?: string | null): string {
  const gross = multiplyDecimals(qty, price);
  fee ??= "0";
  return side === "buy" ? negateDecimal(sumDecimals([gross, fee])) : subtractDecimals(gross, fee);
}

export type LotValidationError =
  | "invalidNumber"
  | "nonPositiveQuantity"
  | "negativeUnitPrice"
  | "negativeFee"
  | "tooPrecise"
  | "tooLarge";

const LOT_MAX_MAGNITUDE = `1${"0".repeat(LOT_MAX_INTEGER_DIGITS)}`;

/** The server's `NewLot::parse` rules, so a malformed row is flagged while typed. Inputs are normalised. */
export function validateLot(quantity: string, unitPrice: string, fee = "0"): LotValidationError | null {
  const figures = [quantity, unitPrice, fee].map(canonicalDecimal);
  if (figures.some((f) => f === null)) return "invalidNumber";
  const [q, p, f] = figures as string[];
  if (compareDecimals(q, "0") <= 0) return "nonPositiveQuantity";
  if (compareDecimals(p, "0") < 0) return "negativeUnitPrice";
  if (compareDecimals(f, "0") < 0) return "negativeFee";
  if ([q, p, f].some((x) => (x.split(".")[1] ?? "").length > LOT_DECIMAL_PLACES)) return "tooPrecise";
  if ([q, p, f].some((x) => compareDecimals(x.replace("-", ""), LOT_MAX_MAGNITUDE) >= 0)) return "tooLarge";
  return null;
}
