// Deterministic helpers for the fake dataset: the same data on every reset.

const DAY_MS = 86_400_000;

/** Today at UTC midnight, the anchor every generated date counts back from. */
export const TODAY = Math.floor(Date.now() / DAY_MS) * DAY_MS;

export function daysAgo(n: number): number {
  return TODAY - n * DAY_MS;
}

export function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function dayOf(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export { DAY_MS };

/** mulberry32: a tiny seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function money(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

/** Stable fake UUIDs: `id("acc", 1)` → `00000000-0000-4000-8acc-000000000001`. */
export function id(tag: string, n: number): string {
  const hex = [...tag].map((c) => c.charCodeAt(0).toString(16)).join("").slice(0, 3).padEnd(3, "0");
  return `00000000-0000-4000-8${hex}-${String(n).padStart(12, "0")}`;
}

/** Days back from `RANGE` keys, as the backend's `range_window`. */
export function rangeDays(range: string): number {
  switch (range) {
    case "24h": return 1;
    case "7d": return 7;
    case "1mo": return 30;
    case "6mo": return 182;
    case "1y": return 365;
    case "ytd": {
      const now = new Date(TODAY);
      return Math.round((TODAY - Date.UTC(now.getUTCFullYear(), 0, 1)) / DAY_MS);
    }
    default: return 4000;
  }
}
