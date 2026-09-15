import { describe, it, expect } from "vitest";
import { keys } from "./keys";

// The property the whole scheme rests on: a read site's key must start with the
// family prefix an invalidation site uses, or the invalidation silently misses.
describe("parameterised keys", () => {
  it("omitting the parameter yields the prefix of the parameterised key", () => {
    expect(keys.netWorth("1y").slice(0, 1)).toEqual(keys.netWorth());
    expect(keys.accountSeries("3mo").slice(0, 1)).toEqual(keys.accountSeries());
    expect(keys.transactions({ search: "x" }).slice(0, 1)).toEqual(keys.transactions());
    expect(keys.holdingPrices("h1", "1y").slice(0, 2)).toEqual(keys.holdingPrices("h1"));
  });

  it("keeps the wire-level key strings the caches were built on", () => {
    expect(keys.netWorth("1y")).toEqual(["net-worth", "1y"]);
    expect(keys.holdingPrices("h1")).toEqual(["holding-prices", "h1"]);
    expect(keys.providersEnabled()).toEqual(["providers-enabled"]);
  });
});
