import { describe, it, expect } from "vitest";
import { passwordLengthOk } from "./password";

describe("passwordLengthOk", () => {
  it("accepts 8 to 128 characters", () => {
    expect(passwordLengthOk("a".repeat(7))).toBe(false);
    expect(passwordLengthOk("a".repeat(8))).toBe(true);
    expect(passwordLengthOk("a".repeat(128))).toBe(true);
    expect(passwordLengthOk("a".repeat(129))).toBe(false);
  });
  it("counts characters like the server, not UTF-16 units", () => {
    expect(passwordLengthOk("😀😀😀😀")).toBe(false);
    expect(passwordLengthOk("éééééééé")).toBe(true);
  });
});
