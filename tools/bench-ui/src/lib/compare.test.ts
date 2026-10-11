import { describe, expect, it } from 'vitest'
import { change } from './compare'
import { summarize } from './stats'

describe('change', () => {
  it('reports a clear speedup as signal', () => {
    const c = change(summarize([10, 11, 12, 13])!, summarize([5, 6, 7, 8])!)
    expect(c.noise).toBe(false)
    expect(c.deltaPercent).toBeCloseTo(((6 - 11) / 11) * 100)
  })
  it('calls overlapping middle halves noise', () => {
    expect(change(summarize([10, 11, 12, 13])!, summarize([11, 12, 13, 14])!).noise).toBe(true)
  })
  it('has no percentage from a zero reference', () => {
    expect(change(summarize([0])!, summarize([1])!).deltaPercent).toBeNull()
  })
})
