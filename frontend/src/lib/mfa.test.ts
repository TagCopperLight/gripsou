import { describe, it, expect } from "vitest";
import { sixDigits } from "./mfa";

describe("sixDigits", () => {
  it("keeps the first six digits", () => {
    expect(sixDigits("12 34-56 78")).toBe("123456");
    expect(sixDigits("ab1")).toBe("1");
  });
});
