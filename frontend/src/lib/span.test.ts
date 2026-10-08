import { describe, it, expect } from "vitest";
import { spanBetween } from "./span";

describe("spanBetween", () => {
  it("counts whole years and months", () => {
    expect(spanBetween("2024-12-17", "2026-10-08")).toEqual({ years: 1, months: 9, days: 0 });
    expect(spanBetween("2024-12-08", "2026-10-08")).toEqual({ years: 1, months: 10, days: 0 });
  });

  it("falls back to days under a month", () => {
    expect(spanBetween("2026-09-30", "2026-10-08")).toEqual({ years: 0, months: 0, days: 8 });
  });

  it("does not count a month that is not complete", () => {
    expect(spanBetween("2026-05-20", "2026-10-08")).toEqual({ years: 0, months: 4, days: 0 });
  });
});
