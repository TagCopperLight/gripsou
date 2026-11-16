// Looking through funds: each holding's value is spread over its fund's country
// and sector weights. Cash never enters; a holding with no composition is left
// out of sector and region breakdowns but still counts "by index".

import type { Allocation, Composition } from "../api/wire";
import { countryCode } from "./composition-i18n";
import { trackedIndex } from "./indices";

export type ExposureHolding = {
  name: string;
  kind: string;
  value: number;
  composition: Composition | null;
};

/** The unlisted remainder of a fund, and countries in no known region. */
export const OTHER = "other";

export const STOCKS = "stocks";

export type Region = "northAmerica" | "europe" | "asiaPacific" | typeof OTHER;

/** Largest entries kept, the rest folded into OTHER so slivers don't crowd the donut. */
const TOP_SECTORS = 6;
const TOP_COUNTRIES_PER_REGION = 5;

export type Slice = {
  key: string;
  /** Raw name (a Boursorama label, an index), or OTHER / STOCKS. */
  name: string;
  share: number;
};

export type RegionSlice = Slice & {
  key: Region;
  /** Each country's share of the breakdown's total (not of its region). */
  countries: Slice[];
};

export type Exposure = {
  sectors: Slice[];
  regions: RegionSlice[];
  /** Shares held directly are one STOCKS slice, funds of no known index OTHER. */
  indices: Slice[];
  /** Value of every holding. */
  total: number;
  /** Value of the holdings that sectors and regions are made of. */
  covered: number;
};

// One home per country; others fall into OTHER. Latin America and Middle East &
// Africa are too small in typical funds to be regions.
const REGION_OF: Record<string, Region> = {
  US: "northAmerica", CA: "northAmerica",
  GB: "europe", FR: "europe", DE: "europe", CH: "europe", NL: "europe",
  IT: "europe", ES: "europe", SE: "europe", DK: "europe", IE: "europe",
  FI: "europe", NO: "europe", BE: "europe", AT: "europe", PT: "europe",
  LU: "europe", PL: "europe",
  JP: "asiaPacific", CN: "asiaPacific", KR: "asiaPacific", TW: "asiaPacific",
  IN: "asiaPacific", AU: "asiaPacific", HK: "asiaPacific", SG: "asiaPacific",
  NZ: "asiaPacific", ID: "asiaPacific", TH: "asiaPacific", MY: "asiaPacific",
};

export function regionOf(country: string): Region {
  const code = countryCode(country);
  return (code && REGION_OF[code]) || OTHER;
}

function bySize(a: Slice, b: Slice): number {
  if (a.key === OTHER) return 1;
  if (b.key === OTHER) return -1;
  return b.share - a.share;
}

function spread(into: Map<string, number>, weights: Allocation[], value: number) {
  let listed = 0;
  for (const w of weights) {
    into.set(w.name, (into.get(w.name) ?? 0) + value * w.weight);
    listed += w.weight;
  }
  const rest = 1 - listed;
  // Rounding in the source can leave a hair either side of 100%.
  if (rest > 0.001) into.set(OTHER, (into.get(OTHER) ?? 0) + value * rest);
}

function toSlices(sums: Map<string, number>, total: number): Slice[] {
  return [...sums]
    .filter(([, v]) => v > 0)
    .map(([name, v]) => ({ key: name, name, share: v / total }))
    .sort(bySize);
}

export function capped(slices: Slice[], n: number): Slice[] {
  const named = slices.filter((s) => s.key !== OTHER);
  if (named.length <= n) return slices;
  const rest = slices
    .filter((s) => s.key === OTHER || !named.slice(0, n).includes(s))
    .reduce((sum, s) => sum + s.share, 0);
  return [...named.slice(0, n), { key: OTHER, name: OTHER, share: rest }];
}

export function exposure(holdings: ExposureHolding[]): Exposure {
  const held = holdings.filter((h) => h.value > 0);
  const total = held.reduce((s, h) => s + h.value, 0);
  const withData = held.filter(
    (h) => h.composition && (h.composition.countries.length > 0 || h.composition.sectors.length > 0),
  );
  const covered = withData.reduce((s, h) => s + h.value, 0);

  const sectorSums = new Map<string, number>();
  const countrySums = new Map<string, number>();
  for (const h of withData) {
    spread(sectorSums, h.composition!.sectors, h.value);
    spread(countrySums, h.composition!.countries, h.value);
  }

  const regionSums = new Map<Region, Map<string, number>>();
  for (const [country, v] of countrySums) {
    const region = country === OTHER ? OTHER : regionOf(country);
    const countries = regionSums.get(region) ?? new Map<string, number>();
    countries.set(country, (countries.get(country) ?? 0) + v);
    regionSums.set(region, countries);
  }
  const regions: RegionSlice[] = [...regionSums]
    .map(([region, countries]) => {
      const sum = [...countries.values()].reduce((s, v) => s + v, 0);
      return {
        key: region,
        name: region,
        share: covered > 0 ? sum / covered : 0,
        // A region's lone OTHER needs no child: it would just repeat the region.
        countries: region === OTHER ? [] : capped(toSlices(countries, covered), TOP_COUNTRIES_PER_REGION),
      };
    })
    .sort(bySize) as RegionSlice[];

  const indexSums = new Map<string, number>();
  for (const h of held) {
    const group = h.kind === "equity" ? STOCKS : (h.kind === "etf" && trackedIndex(h.name)) || OTHER;
    indexSums.set(group, (indexSums.get(group) ?? 0) + h.value);
  }

  return {
    sectors: covered > 0 ? capped(toSlices(sectorSums, covered), TOP_SECTORS) : [],
    regions: covered > 0 ? regions : [],
    indices: toSlices(indexSums, total),
    total,
    covered,
  };
}
