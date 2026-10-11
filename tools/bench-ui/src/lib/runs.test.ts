import { describe, expect, it } from 'vitest'
import { CLEAN_FINGERPRINT, formatMs, formatPercent, isDirty, trendGroups, trendPoints } from './runs'
import type { RunSet, RunSummary } from '../../shared/types'

const summary = (id: string, fp: string, benchmarks = ['a'], suite = 'backend'): RunSummary => ({
  id, name: id, note: '', createdAt: id, suite, profile: 'typical', fixtureFingerprint: fp,
  commit: 'c', failed: false, benchmarks, error: null,
})
const set = (timestamp: string, samples: number[]): RunSet => ({
  schema_version: 1,
  runs: [{ timestamp, commit: 'abc', measurements: [{ id: 'a', samples_ms: samples }] }],
} as unknown as RunSet)

describe('runs helpers', () => {
  it('detects uncommitted changes', () => {
    expect(isDirty(CLEAN_FINGERPRINT)).toBe(false)
    expect(isDirty('ff')).toBe(true)
  })
  it('groups trend candidates by suite and fixture, largest first', () => {
    const groups = trendGroups([summary('1', 'x'), summary('2', 'y'), summary('3', 'y'), summary('4', 'y', ['b'])], 'a')
    expect(groups.map((g) => [g.key, g.runs.length])).toEqual([['backend:y', 2], ['backend:x', 1]])
  })
  it('orders trend points by timestamp', () => {
    const pts = trendPoints([
      { summary: summary('late', 'x'), set: set('2026-10-02T00:00:00Z', [3]) },
      { summary: summary('early', 'x'), set: set('2026-10-01T00:00:00Z', [1, 2]) },
    ], 'a')
    expect(pts.map((p) => [p.name, p.median])).toEqual([['early', 1], ['late', 3]])
  })
  it('formats', () => {
    expect(formatMs(12)).toBe('12.0 ms')
    expect(formatMs(1234.5)).toBe('1.23 s')
    expect(formatMs(null)).toBe('—')
    expect(formatPercent(-24.4)).toBe('−24%')
    expect(formatPercent(3)).toBe('+3%')
  })
})
