import { describe, it, expect } from "vitest";
import { exposure, regionOf, OTHER, type ExposureHolding } from "./exposure";

const fund = (
  key: string,
  value: number,
  countries: [string, number][],
  sectors: [string, number][],
): ExposureHolding => ({
  key,
  name: key,
  value,
  composition: {
    countries: countries.map(([name, weight]) => ({ name, weight })),
    sectors: sectors.map(([name, weight]) => ({ name, weight })),
  },
});

const shares = (slices: { key: string; share: number }[]) =>
  Object.fromEntries(slices.map((s) => [s.key, Number(s.share.toFixed(4))]));

describe("regionOf", () => {
  it("maps known countries to a geographic region", () => {
    expect(regionOf("Etats-Unis")).toBe("northAmerica");
    expect(regionOf("Pays-Bas")).toBe("europe");
    expect(regionOf("Japon")).toBe("asiaPacific");
  });

  it("puts unknown countries in other", () => {
    expect(regionOf("Atlantide")).toBe(OTHER);
  });
});

describe("exposure", () => {
  it("weights each fund's composition by its value", () => {
    const e = exposure([
      fund("A", 300, [["Etats-Unis", 1]], [["Technologie", 1]]),
      fund("B", 100, [["France", 1]], [["Santé", 1]]),
    ]);
    expect(shares(e.sectors)).toEqual({ Technologie: 0.75, Santé: 0.25 });
    expect(shares(e.regions)).toEqual({ northAmerica: 0.75, europe: 0.25 });
  });

  it("gives a fund's unlisted remainder to other, sorted last", () => {
    const e = exposure([fund("A", 100, [["Etats-Unis", 0.9]], [["Technologie", 0.02]])]);
    expect(e.sectors.map((s) => s.key)).toEqual(["Technologie", OTHER]);
    expect(e.sectors.at(-1)).toMatchObject({ key: OTHER, share: 0.98 });
    expect(e.regions.at(-1)).toMatchObject({ key: OTHER, countries: [] });
    expect(e.regions.at(-1)!.share).toBeCloseTo(0.1);
  });

  it("ignores rounding noise around 100%", () => {
    const e = exposure([fund("A", 100, [["Etats-Unis", 0.9995]], [["Technologie", 1.0004]])]);
    expect(e.regions.map((r) => r.key)).toEqual(["northAmerica"]);
    expect(e.sectors.map((s) => s.key)).toEqual(["Technologie"]);
  });

  it("nests countries under their region with shares of the whole", () => {
    const e = exposure([
      fund("A", 100, [["Etats-Unis", 0.7], ["Canada", 0.1], ["France", 0.2]], [["Technologie", 1]]),
    ]);
    const na = e.regions.find((r) => r.key === "northAmerica")!;
    expect(na.share).toBeCloseTo(0.8);
    expect(shares(na.countries)).toEqual({ "Etats-Unis": 0.7, Canada: 0.1 });
  });

  it("leaves holdings without data out of sectors and regions only", () => {
    const e = exposure([
      fund("A", 90, [["Etats-Unis", 1]], [["Technologie", 1]]),
      { key: "S", name: "Stock", value: 10, composition: null },
    ]);
    expect(shares(e.regions)).toEqual({ northAmerica: 1 });
    expect(shares(e.holdings)).toEqual({ A: 0.9, S: 0.1 });
    expect(e.excluded).toEqual([{ key: "S", name: "Stock", share: 0.1 }]);
    expect(e.covered).toBe(90);
    expect(e.total).toBe(100);
  });

  it("merges the same security held in two accounts", () => {
    const e = exposure([
      fund("A", 50, [["Etats-Unis", 1]], [["Technologie", 1]]),
      fund("A", 50, [["Etats-Unis", 1]], [["Technologie", 1]]),
    ]);
    expect(e.holdings).toEqual([{ key: "A", name: "A", share: 1 }]);
  });

  it("is empty without any data", () => {
    const e = exposure([{ key: "S", name: "Stock", value: 10, composition: null }]);
    expect(e.sectors).toEqual([]);
    expect(e.regions).toEqual([]);
    expect(e.holdings).toHaveLength(1);
  });
});
