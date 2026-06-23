import { describe, it, expect } from "vitest";
import { coverCrop } from "./avatar";

describe("coverCrop", () => {
  it("returns the full square for a square source", () => {
    expect(coverCrop(200, 200)).toEqual({ sx: 0, sy: 0, side: 200 });
  });

  it("centers horizontally on a landscape source", () => {
    expect(coverCrop(300, 100)).toEqual({ sx: 100, sy: 0, side: 100 });
  });

  it("centers vertically on a portrait source", () => {
    expect(coverCrop(100, 300)).toEqual({ sx: 0, sy: 100, side: 100 });
  });
});
