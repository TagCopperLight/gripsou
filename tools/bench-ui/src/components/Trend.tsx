import { escapeHtml } from '../lib/html'
import ReactECharts from 'echarts-for-react'
import { useState } from 'react'
import { useRuns, useRunSets } from '../api'
import { formatMs, trendGroups, trendPoints } from '../lib/runs'

export function Trend() {
  const runs = useRuns()
  const all = (runs.data ?? []).filter((r) => !r.error)
  const benchmarks = [...new Set(all.flatMap((r) => r.benchmarks))].sort()
  const [benchmark, setBenchmark] = useState('')
  const b = benchmarks.includes(benchmark) ? benchmark : benchmarks[0] ?? ''
  const groups = trendGroups(all, b)
  const [groupKey, setGroupKey] = useState('')
  const group = groups.find((g) => g.key === groupKey) ?? groups[0]
  const { data } = useRunSets(group?.runs.map((r) => r.id) ?? [])
  const points = trendPoints((group?.runs ?? []).filter((r) => data[r.id]).map((r) => ({ summary: r, set: data[r.id].set })), b)

  if (!benchmarks.length) return <p className="muted">No saved runs yet.</p>
  const baseLabel = (g: (typeof groups)[number]) => `${g.suite} · ${g.profile ?? '?'}`
  const groupLabel = (g: (typeof groups)[number]) => {
    const label = baseLabel(g)
    const shared = groups.filter((o) => baseLabel(o) === label).length > 1
    return `${label}${shared ? ` #${(g.runs[0].fixtureFingerprint ?? '').slice(0, 6)}` : ''} (${g.runs.length} runs)`
  }
  const option = {
    animation: false,
    grid: { left: 70, right: 24, top: 30, bottom: 60 },
    legend: { data: ['median', 'p95'] },
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
    <div>
      <h1>Trend over time</h1>
      <label>Benchmark <select value={b} onChange={(e) => setBenchmark(e.target.value)}>
        {benchmarks.map((id) => <option key={id}>{id}</option>)}
      </select></label>{' '}
      {groups.length > 1 && (
        <label>Runs with <select value={group?.key} onChange={(e) => setGroupKey(e.target.value)}>
          {groups.map((g) => <option key={g.key} value={g.key}>{groupLabel(g)}</option>)}
        </select></label>
      )}
      <p className="small muted">Only runs with the same group and identical fake data are shown together.</p>
      {points.length < 2 ? <p className="muted">Need at least two matching runs.</p> : <ReactECharts option={option} notMerge style={{ height: 380 }} />}
    </div>
  )
}
