import { describe, it, expect } from "vitest";

import { hexToHsv, hsvToHex } from "./color";

describe("hexToHsv / hsvToHex", () => {
  it("reads a colour as the picker's axes and back without drift", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#000000")).toMatchObject({ s: 0, v: 0 });
    for (const c of ["#e0605f", "#5b9bf0", "#9aa4b2", "#ffffff", "#123abc"]) expect(hsvToHex(hexToHsv(c))).toBe(c);
  });
});
