import { Fragment, useState } from 'react'
import { useRunSets } from '../api'
import { PALETTE } from '../lib/palette'
import { formatMs, isDirty } from '../lib/runs'
import { firstMs, pooledSamples, summarize } from '../lib/stats'
import { SampleDots } from './SampleDots'

export function RunDetail({ id }: { id: string }) {
  const { data, isLoading } = useRunSets([id])
  const [open, setOpen] = useState<string | null>(null)
  if (isLoading) return <p className="muted">Loading…</p>
  const loaded = data[id]
  if (!loaded) return <div className="error">Could not read this run.</div>
  const { set, label } = loaded
  const first = set.runs[0]
  const ids = [...new Set(set.runs.flatMap((r) => r.measurements.map((m) => m.id)))]
  const fixture = first.fixture as Record<string, unknown>
  return (
    <div>
      <h1>{label?.name ?? id}</h1>
      {label?.note && <p>{label.note}</p>}
      <div className="meta muted small">
        <span>commit {first.commit.slice(0, 10)}{isDirty(first.dirty_fingerprint) ? ' + uncommitted changes' : ''}</span>
        <span>{first.timestamp.slice(0, 19).replace('T', ' ')}</span>
        <span>{first.suite} · {String(fixture.profile)} · {String(fixture.transactions)} transactions · {String(fixture.days)} days</span>
        <span>{set.runs.length} repeat{set.runs.length > 1 ? 's' : ''} · {first.warmups} warmups</span>
        {Object.entries(first.environment).map(([k, v]) => <span key={k}>{k}: {typeof v === 'string' ? v : JSON.stringify(v)}</span>)}
      </div>
      {set.runs.flatMap((r) => r.errors).map((e, i) => <div key={i} className="error">{e}</div>)}
      <table>
        <thead><tr><th>Benchmark</th><th>Median</th><th>p95</th><th>Samples</th><th>First (cold)</th><th></th></tr></thead>
        <tbody>
          {ids.map((mid) => {
            const s = summarize(pooledSamples(set, mid))
            const ms = set.runs.map((r) => r.measurements.find((m) => m.id === mid)).filter((m) => m !== undefined)
            const ok = ms.every((m) => m.correct)
            return (
              <Fragment key={mid}>
                <tr className={`clickable${open === mid ? ' open' : ''}`} onClick={() => setOpen(open === mid ? null : mid)}>
                  <td>{open === mid ? '▾' : '▸'} {mid}</td>
                  <td>{formatMs(s?.median ?? null)}</td><td>{formatMs(s?.p95 ?? null)}</td>
                  <td>{s?.n ?? 0}</td><td>{formatMs(firstMs(set, mid))}</td>
                  <td>{ok ? <span className="good">✓</span> : <span className="bad">✗ {ms.flatMap((m) => m.errors)[0]}</span>}</td>
                </tr>
                {open === mid && (
                  <tr><td colSpan={6} style={{ whiteSpace: 'normal' }}>
                    <SampleDots lanes={set.runs.map((r, i) => ({ name: set.runs.length > 1 ? `repeat ${i + 1}` : 'samples', samples: r.measurements.find((m) => m.id === mid)?.samples_ms ?? [], color: PALETTE[1 + (i % (PALETTE.length - 1))] }))} />
                    <p className="small muted">{ms[0]?.boundary}</p>
                    {Object.keys(ms[0]?.diagnostics ?? {}).length > 0 && (
                      <details><summary>Diagnostics</summary><pre className="log">{JSON.stringify(ms[0]!.diagnostics, null, 2)}</pre></details>
                    )}
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
