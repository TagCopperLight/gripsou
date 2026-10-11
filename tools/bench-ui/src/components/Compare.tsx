import { useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { fetchCompare, useRunSets } from '../api'
import { change } from '../lib/compare'
import { PALETTE } from '../lib/palette'
import { formatMs, formatPercent } from '../lib/runs'
import { pooledSamples, summarize } from '../lib/stats'
import { SampleDots } from './SampleDots'

export function Compare({ ids }: { ids: string[] }) {
  const [reference, setReference] = useState(ids[0])
  const ref = ids.includes(reference) ? reference : ids[0]
  const order = [ref, ...ids.filter((id) => id !== ref)]
  const { data, isLoading } = useRunSets(order)
  const [open, setOpen] = useState<string | null>(null)
  const verdicts = useQuery({
    queryKey: ['compare', ref, ...order.slice(1)],
    queryFn: () => fetchCompare(ref, order.slice(1)),
    staleTime: Infinity,
  })
  if (isLoading) return <p className="muted">Loading…</p>
  const name = (id: string) => data[id]?.label?.name ?? id
  const benchmarks = [...new Set(order.flatMap((id) => data[id]?.set.runs.flatMap((r) => r.measurements.map((m) => m.id)) ?? []))]
  const stats = (id: string, b: string) => (data[id] ? summarize(pooledSamples(data[id].set, b)) : null)

  return (
    <div>
      <h1>Comparing {order.length} runs</h1>
      <label>Reference: <select value={ref} onChange={(e) => setReference(e.target.value)}>
        {order.map((id) => <option key={id} value={id}>{name(id)}</option>)}
      </select></label>
      <p className="small muted">Lower is faster. Grey percentages are within normal variation (the middle halves of the measurements overlap).</p>
      {verdicts.isLoading && <p className="muted small">Checking the runs are comparable…</p>}
      {verdicts.error && <div className="warn">Could not check compatibility: {verdicts.error.message}</div>}
      {verdicts.data && Object.entries(verdicts.data).filter(([, v]) => !v.compatible).map(([id, v]) => (
        <div key={id} className="warn">
          ⚠ <b>{name(id)}</b> vs <b>{name(ref)}</b>: timings may not be comparable.
          <ul>{v.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      ))}
      <table>
        <thead><tr><th>Benchmark</th>{order.map((id, i) => <th key={id} style={{ color: PALETTE[i % PALETTE.length] }}>{name(id)}</th>)}</tr></thead>
        <tbody>
          {benchmarks.map((b) => {
            const base = stats(ref, b)
            return (
              <Fragment key={b}>
                <tr className={`clickable${open === b ? ' open' : ''}`} onClick={() => setOpen(open === b ? null : b)}>
                  <td>{open === b ? '▾' : '▸'} {b}</td>
                  {order.map((id, i) => {
                    const s = stats(id, b)
                    if (!s) return <td key={id}>—</td>
                    if (i === 0 || !base) return <td key={id}>{formatMs(s.median)}</td>
                    const c = change(base, s)
                    const cls = c.noise ? 'noise' : (c.deltaPercent ?? 0) < 0 ? 'good' : 'bad'
                    return <td key={id}>{formatMs(s.median)} <span className={cls}>{formatPercent(c.deltaPercent)}</span></td>
                  })}
                </tr>
                {open === b && (
                  <tr><td colSpan={order.length + 1} style={{ whiteSpace: 'normal' }}>
                    <SampleDots lanes={order.map((id, i) => ({ name: name(id), samples: data[id] ? pooledSamples(data[id].set, b) : [], color: PALETTE[i % PALETTE.length] }))} />
                  </td></tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
