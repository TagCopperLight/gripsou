import { overallFraction } from '../../shared/progress'
import { deleteRun, renameRun, useJobs, useRuns } from '../api'
import type { View } from '../App'
import { ProgressBar } from './ProgressBar'

interface Props { view: View; onView(v: View): void; selected: string[]; onSelected(ids: string[]): void }

export function Sidebar({ view, onView, selected, onSelected }: Props) {
  const jobs = useJobs().filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'failed')
  const runs = useRuns()
  const toggle = (id: string) => {
    onSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
    onView({ kind: 'runs' })
  }
  return (
    <aside className="sidebar">
      <button className="primary" onClick={() => onView({ kind: 'new' })}>+ New run</button>
      <button className={view.kind === 'trend' ? 'tab active' : 'tab'} onClick={() => onView({ kind: 'trend' })}>Trend over time</button>
      {jobs.map((j) => (
        <div key={j.id} className={`item job${view.kind === 'job' && view.id === j.id ? ' active' : ''}`} onClick={() => onView({ kind: 'job', id: j.id })}>
          <b>{j.options.name}</b> <span className={`muted status-${j.status}`}>{j.status}</span>
          {j.status === 'running' && <ProgressBar small value={overallFraction(j)} />}
        </div>
      ))}
      <div className="label">Saved runs</div>
      {runs.data?.length === 0 && <p className="muted">No runs yet.</p>}
      {runs.data?.map((r) => (
        <div key={r.id} className={`item${r.error ? ' unreadable' : ''}`} title={r.error ?? r.note}>
          <label>
            <input type="checkbox" disabled={!!r.error} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
            <b>{r.name}</b> {r.failed && !r.error && <span className="bad">✗</span>}
          </label>
          <div className="muted small">
            {r.error ? r.error : `${r.createdAt.slice(0, 16).replace('T', ' ')} · ${r.profile ?? '?'} · ${r.suite ?? '?'}`}
          </div>
          <div className="row-actions">
            <button onClick={() => { const name = prompt('New name', r.name); if (name) void renameRun(r.id, { name }) }}>Rename</button>
            <button onClick={() => { const note = prompt('Note', r.note); if (note !== null) void renameRun(r.id, { note }) }}>Note</button>
            <button onClick={() => { if (confirm(`Delete “${r.name}”?`)) { onSelected(selected.filter((s) => s !== r.id)); void deleteRun(r.id) } }}>Delete</button>
          </div>
        </div>
      ))}
    </aside>
  )
}
