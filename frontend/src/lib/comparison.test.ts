import { describe, it, expect } from "vitest";

import { compareToBaseline } from "./comparison";

describe("compareToBaseline", () => {
  it("keeps the delta as an exact decimal string", () => {
    expect(compareToBaseline("1260.10", "970.20", "up").delta).toBe("289.90");
  });

  it("calls a fall in spending good and a rise bad", () => {
    expect(compareToBaseline("1940.00", "2010.00", "down").tone).toBe("good");
    expect(compareToBaseline("2100.00", "2010.00", "down").tone).toBe("bad");
  });

  it("calls an unchanged figure flat, whichever direction is good", () => {
    expect(compareToBaseline("800.00", "800.00", "up")).toMatchObject({ tone: "flat", direction: "flat" });
    expect(compareToBaseline("800.00", "800.00", "down").tone).toBe("flat");
  });

  it("gives a ratio against a non-zero baseline and none against zero", () => {
    expect(compareToBaseline("110", "100", "up").ratio).toBeCloseTo(0.1);
    expect(compareToBaseline("-90", "-100", "up").ratio).toBeCloseTo(0.1);
    expect(compareToBaseline("120", "0.00", "down").ratio).toBeUndefined();
  });
});
