import type { RunSet, RunSummary } from '../../shared/types'
import { pooledSamples, summarize } from './stats'

/** report::fingerprint of an empty diff: the working copy had no changes. */
export const CLEAN_FINGERPRINT = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
export const isDirty = (fp: string) => fp !== CLEAN_FINGERPRINT

export interface TrendGroup { key: string; suite: string; profile: string | null; runs: RunSummary[] }

export function trendGroups(summaries: RunSummary[], benchmark: string): TrendGroup[] {
  const groups = new Map<string, TrendGroup>()
  for (const s of summaries) {
    if (s.error || !s.suite || !s.fixtureFingerprint || !s.benchmarks.includes(benchmark)) continue
    const key = `${s.suite}:${s.fixtureFingerprint}`
    const g = groups.get(key) ?? { key, suite: s.suite, profile: s.profile, runs: [] }
    g.runs.push(s)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.runs.length - a.runs.length)
}

export interface TrendPoint { id: string; name: string; commit: string; timestamp: string; median: number; p95: number }

export function trendPoints(runs: Array<{ summary: RunSummary; set: RunSet }>, benchmark: string): TrendPoint[] {
  return runs
    .flatMap(({ summary, set }) => {
      const s = summarize(pooledSamples(set, benchmark))
      const r = set.runs[0]
      return s ? [{ id: summary.id, name: summary.name, commit: r.commit, timestamp: r.timestamp, median: s.median, p95: s.p95 }] : []
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toPrecision(3)} s` : `${ms.toFixed(ms < 10 ? 2 : 1)} ms`
}

export function formatPercent(p: number | null): string {
  if (p === null) return '—'
  const r = Math.round(p)
  return r < 0 ? `−${-r}%` : `+${r}%`
}
