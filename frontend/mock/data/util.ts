import { RANGE_DAYS_BACK, type Range } from "../../src/api/wire.ts";

const DAY_MS = 86_400_000;

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

export const EUR_PER_USD = 0.92;

export function rangeDays(range: Range): number {
  return RANGE_DAYS_BACK[range]
    ?? Math.round((TODAY - Date.UTC(new Date(TODAY).getUTCFullYear(), 0, 1)) / DAY_MS);
}
