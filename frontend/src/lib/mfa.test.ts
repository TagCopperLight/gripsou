import { describe, it, expect } from "vitest";
import { codeDigits } from "./mfa";

describe("codeDigits", () => {
  it("keeps the first six digits", () => {
    expect(codeDigits("12 34-56 78")).toBe("123456");
    expect(codeDigits("ab1")).toBe("1");
  });
});
