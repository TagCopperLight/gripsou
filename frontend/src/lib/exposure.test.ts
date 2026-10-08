import { describe, it, expect } from "vitest";
import { capped, exposure, regionOf, OTHER, STOCKS, type ExposureHolding } from "./exposure";

const fund = (
  key: string,
  value: number,
  countries: [string, number][],
  sectors: [string, number][],
): ExposureHolding => ({
  name: key,
  kind: "etf",
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

  it("puts unknown countries, and regions too small to show, in other", () => {
    expect(regionOf("Atlantide")).toBe(OTHER);
    expect(regionOf("Brésil")).toBe(OTHER);
  });
});

describe("capped", () => {
  const sl = (key: string, share: number) => ({ key, name: key, share });

  it("keeps the largest and folds the rest, OTHER included, into OTHER", () => {
    expect(capped([sl("a", 0.5), sl("b", 0.3), sl("c", 0.1), sl(OTHER, 0.1)], 1)).toEqual([
      sl("a", 0.5),
      { key: OTHER, name: OTHER, share: 0.5 },
    ]);
  });

  it("leaves short lists alone", () => {
    const short = [sl("a", 0.6), sl(OTHER, 0.4)];
    expect(capped(short, 1)).toBe(short);
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
      { name: "Stock", kind: "equity", value: 10, composition: null },
    ]);
    expect(shares(e.regions)).toEqual({ northAmerica: 1 });
    expect(shares(e.indices)).toEqual({ [OTHER]: 0.9, [STOCKS]: 0.1 });
    expect(e.covered).toBe(90);
    expect(e.total).toBe(100);
  });

  it("groups funds by the index they track, stocks together, the rest as other", () => {
    const none: [string, number][] = [];
    const e = exposure([
      fund("Example MSCI World", 40, none, none),
      fund("Other MSCI World", 20, none, none),
      fund("Example S&P 500", 20, none, none),
      fund("Example Robotics", 5, none, none),
      { name: "Example Coin", kind: "crypto", value: 5, composition: null },
      { name: "Example Corp", kind: "equity", value: 6, composition: null },
      { name: "Other Corp", kind: "equity", value: 4, composition: null },
    ]);
    expect(e.indices.map((s) => s.key)).toEqual(["MSCI World", "S&P 500", STOCKS, OTHER]);
    expect(shares(e.indices)).toEqual({ "MSCI World": 0.6, "S&P 500": 0.2, [STOCKS]: 0.1, [OTHER]: 0.1 });
  });

  it("keeps the top sectors and the top countries of each region", () => {
    const countries: [string, number][] = [
      ["Royaume-Uni", 0.3], ["France", 0.2], ["Suisse", 0.15], ["Allemagne", 0.15],
      ["Pays-Bas", 0.1], ["Suède", 0.06], ["Danemark", 0.04],
    ];
    const sectors: [string, number][] = [
      ["a", 0.3], ["b", 0.2], ["c", 0.15], ["d", 0.1], ["e", 0.1], ["f", 0.05], ["g", 0.05], ["h", 0.05],
    ];
    const e = exposure([fund("A", 100, countries, sectors)]);
    expect(e.sectors.map((s) => s.key)).toEqual(["a", "b", "c", "d", "e", "f", OTHER]);
    expect(e.sectors.at(-1)!.share).toBeCloseTo(0.1);
    const europe = e.regions.find((r) => r.key === "europe")!;
    expect(europe.countries).toHaveLength(6);
    expect(europe.countries.at(-1)).toMatchObject({ key: OTHER });
    expect(europe.countries.at(-1)!.share).toBeCloseTo(0.1);
  });

  it("is empty without any data", () => {
    const e = exposure([{ name: "Stock", kind: "equity", value: 10, composition: null }]);
    expect(e.sectors).toEqual([]);
    expect(e.regions).toEqual([]);
    expect(e.indices).toHaveLength(1);
  });
});
