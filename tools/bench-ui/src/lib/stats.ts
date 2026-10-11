import type { RunSet } from '../../shared/types'

export interface Stats { n: number; min: number; q1: number; median: number; q3: number; p95: number; max: number }

/** Nearest-rank on sorted input, as in backend/bench/src/report.rs. */
export function quantile(sorted: number[], p: number): number {
  return sorted[Math.max(Math.ceil(sorted.length * p), 1) - 1]
}

export function summarize(samples: number[]): Stats | null {
  if (samples.length === 0) return null
  const s = [...samples].sort((a, b) => a - b)
  return {
    n: s.length, min: s[0], q1: quantile(s, 0.25), median: quantile(s, 0.5),
    q3: quantile(s, 0.75), p95: quantile(s, 0.95), max: s[s.length - 1],
  }
}

/** All samples of one benchmark across the set's independent runs (--repeat). */
export function pooledSamples(set: RunSet, id: string): number[] {
  return set.runs.flatMap((r) => r.measurements.find((m) => m.id === id)?.samples_ms ?? [])
}

export function firstMs(set: RunSet, id: string): number | null {
  return set.runs[0]?.measurements.find((m) => m.id === id)?.first_ms ?? null
}
