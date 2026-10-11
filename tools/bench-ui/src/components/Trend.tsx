import { escapeHtml } from '../lib/html'
import ReactECharts from 'echarts-for-react'
import { useState } from 'react'
import type { RunSummary } from '../../shared/types'
import { useRuns, useRunSets } from '../api'
import { formatMs, trendGroups, trendPoints } from '../lib/runs'

export function Trend() {
  const runs = useRuns()
  const all = (runs.data ?? []).filter((r) => !r.error)
  const benchmarks = [...new Set(all.flatMap((r) => r.benchmarks))].sort()

  if (!benchmarks.length) return <p className="muted">No saved runs yet.</p>
  return (
    <div>
      <h1>Trend over time</h1>
      <p className="small muted">Only runs with the same group and identical fake data are shown together.</p>
      <div className="trend-grid">
        {benchmarks.map((benchmark) => <BenchmarkTrend key={benchmark} benchmark={benchmark} runs={all} />)}
      </div>
    </div>
  )
}

function BenchmarkTrend({ benchmark, runs }: { benchmark: string; runs: RunSummary[] }) {
  const groups = trendGroups(runs, benchmark)
  const [groupKey, setGroupKey] = useState('')
  const group = groups.find((g) => g.key === groupKey) ?? groups[0]
  const { data, isLoading } = useRunSets(group?.runs.map((r) => r.id) ?? [])
  const points = trendPoints((group?.runs ?? []).filter((r) => data[r.id]).map((r) => ({ summary: r, set: data[r.id].set })), benchmark)

  const baseLabel = (g: (typeof groups)[number]) => `${g.suite} · ${g.profile ?? '?'}`
  const groupLabel = (g: (typeof groups)[number]) => {
    const label = baseLabel(g)
    const shared = groups.filter((o) => baseLabel(o) === label).length > 1
    const count = g.runs.length === 1 ? '1 run' : `${g.runs.length} runs`
    return `${label}${shared ? ` #${(g.runs[0].fixtureFingerprint ?? '').slice(0, 6)}` : ''} (${count})`
  }
  const option = {
    animation: false,
    grid: { left: 70, right: 24, top: 40, bottom: 70 },
    legend: { top: 0, right: 0, data: ['median', 'p95'] },
    xAxis: { type: 'category', data: points.map((p) => p.timestamp.slice(0, 16).replace('T', ' ')), axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: 'ms', min: 0 },
    tooltip: {
      trigger: 'axis',
      formatter: (items: Array<{ dataIndex: number }>) => {
        const p = points[items[0].dataIndex]
        return `<b>${escapeHtml(p.name)}</b><br/>commit ${escapeHtml(p.commit.slice(0, 10))}<br/>median ${formatMs(p.median)} · p95 ${formatMs(p.p95)}`
      },
    },
    series: [
      { name: 'median', type: 'line', data: points.map((p) => p.median), symbolSize: 7, itemStyle: { color: '#3b6fe0' } },
      { name: 'p95', type: 'line', data: points.map((p) => p.p95), lineStyle: { type: 'dashed' }, symbolSize: 5, itemStyle: { color: '#8a91a0' } },
    ],
  }
  return (
    <section className="trend-card" aria-label={benchmark}>
      <h2>{benchmark}</h2>
      {groups.length > 1 && (
        <label>Runs with <select value={group?.key} onChange={(e) => setGroupKey(e.target.value)}>
          {groups.map((g) => <option key={g.key} value={g.key}>{groupLabel(g)}</option>)}
        </select></label>
      )}
      {isLoading ? <p className="muted">Loading runs…</p> : points.length < 2 ? <p className="muted">Need at least two matching runs.</p> : <ReactECharts option={option} notMerge style={{ height: 240 }} />}
    </section>
  )
}
