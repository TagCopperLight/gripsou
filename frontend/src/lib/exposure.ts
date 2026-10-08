// What the invested money is exposed to, looking through funds: each holding's
// value is spread over its fund's country and sector weights, then summed.
// Cash never enters here, and a holding with no composition data is left out
// of the sector and region breakdowns (but still counts in "by holding").

import { countryCode } from "./composition-i18n";

export type Allocation = { name: string; weight: number };

export type ExposureHolding = {
  /** Groups the same security held in several accounts into one slice. */
  key: string;
  name: string;
  /** Current value, in the reporting currency. */
  value: number;
  composition: { countries: Allocation[]; sectors: Allocation[] } | null;
};

/** The leftover of a fund that lists only its top countries or sectors, and
 *  countries that belong to no known region. */
export const OTHER = "other";

export type Region = "northAmerica" | "europe" | "asiaPacific" | typeof OTHER;

/** Breakdowns keep their largest entries and fold the rest into OTHER, so a
 *  long tail of slivers doesn't crowd the donut and its legend. */
export const TOP_SECTORS = 6;
export const TOP_COUNTRIES_PER_REGION = 5;

export type Slice = {
  key: string;
  /** Raw name (a Boursorama label, a holding name), or OTHER. */
  name: string;
  /** Share of the breakdown's total, 0..1. */
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
  holdings: Slice[];
  /** Holdings left out of sectors and regions for lack of data, with their
   *  share of everything invested. */
  excluded: Slice[];
  /** Value of every holding. */
  total: number;
  /** Value of the holdings that sectors and regions are made of. */
  covered: number;
};

// Geographic, so every country has exactly one home. Countries outside this
// set fall into OTHER rather than being guessed. Latin America and the Middle
// East & Africa weigh too little in typical funds to earn a region of their own.
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

// Largest first, with OTHER always last whatever its size.
function bySize(a: Slice, b: Slice): number {
  if (a.key === OTHER) return 1;
  if (b.key === OTHER) return -1;
  return b.share - a.share;
}

/** Spread `value` over `weights`, the unlisted remainder going to OTHER. */
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

/** The `n` largest slices, everything else (OTHER included) merged into one
 *  OTHER slice at the end. */
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

  const holdingSums = new Map<string, { name: string; value: number }>();
  for (const h of held) {
    const prev = holdingSums.get(h.key);
    holdingSums.set(h.key, { name: h.name, value: (prev?.value ?? 0) + h.value });
  }

  return {
    sectors: covered > 0 ? capped(toSlices(sectorSums, covered), TOP_SECTORS) : [],
    regions: covered > 0 ? regions : [],
    holdings: [...holdingSums]
      .map(([key, { name, value }]) => ({ key, name, share: value / total }))
      .sort(bySize),
    excluded: held
      .filter((h) => !withData.includes(h))
      .map((h) => ({ key: h.key, name: h.name, share: h.value / total })),
    total,
    covered,
  };
}
