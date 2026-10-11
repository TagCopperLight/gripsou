import { describe, expect, it } from 'vitest'
import { pooledSamples, quantile, summarize } from './stats'
import type { RunSet } from '../../shared/types'

describe('nearest-rank stats (same rule as report::statistics)', () => {
  it('picks ranks like the Rust runner', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(quantile(s, 0.5)).toBe(5)
    expect(quantile(s, 0.95)).toBe(10)
    expect(quantile([7], 0.95)).toBe(7)
  })
  it('summarizes unsorted samples', () => {
    expect(summarize([4, 1, 3, 2])).toEqual({ n: 4, min: 1, q1: 1, median: 2, q3: 3, p95: 4, max: 4 })
    expect(summarize([])).toBeNull()
  })
  it('pools samples across independent runs', () => {
    const m = (samples: number[]) => ({ id: 'a', samples_ms: samples }) as never
    const set = { schema_version: 1, runs: [{ measurements: [m([1, 2])] }, { measurements: [m([3])] }] } as unknown as RunSet
    expect(pooledSamples(set, 'a')).toEqual([1, 2, 3])
    expect(pooledSamples(set, 'missing')).toEqual([])
  })
})
