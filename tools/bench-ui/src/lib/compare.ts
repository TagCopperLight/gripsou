import type { Stats } from './stats'

export interface Change { deltaPercent: number | null; noise: boolean }

/** Noise = the middle halves (q1..q3) overlap. A visual cue, not a statistical test. */
export function change(ref: Stats, cand: Stats): Change {
  return {
    deltaPercent: ref.median > 0 ? ((cand.median - ref.median) / ref.median) * 100 : null,
    noise: ref.q1 <= cand.q3 && cand.q1 <= ref.q3,
  }
}
