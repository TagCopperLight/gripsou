import { describe, it, expect } from "vitest";
import LOT_CASES from "../../../shared/lot-cases.json";
import { compareDecimals } from "./decimal";
import type { LotSide } from "../api/wire";
import { lotCashAmount, validateLot } from "./lots";

// The server's rules run through the same cases (backend/core/tests/it/lot_cases.rs).
describe("lotCashAmount", () => {
  it.each(LOT_CASES.cashAmount)("$case", ({ side, quantity, unitPrice, fee, amount }) => {
    const got = lotCashAmount(side as LotSide, quantity, unitPrice, fee);
    expect(compareDecimals(got, amount), `${got} is not ${amount}`).toBe(0);
  });
});

describe("validateLot", () => {
  it.each(LOT_CASES.validation)("$case", ({ quantity, unitPrice, fee, refused }) => {
    expect(validateLot(quantity, unitPrice, fee ?? undefined)).toBe(refused);
  });
});
