import { useState } from 'react'
import { Compare } from './components/Compare'
import { JobView } from './components/JobView'
import { NewRun } from './components/NewRun'
import { RunDetail } from './components/RunDetail'
import { Sidebar } from './components/Sidebar'
import { Trend } from './components/Trend'

export type View = { kind: 'new' } | { kind: 'job'; id: string } | { kind: 'runs' } | { kind: 'trend' }

export function App() {
  const [view, setView] = useState<View>({ kind: 'new' })
  const [selected, setSelected] = useState<string[]>([])
  return (
    <div className="layout">
      <Sidebar view={view} onView={setView} selected={selected} onSelected={setSelected} />
      <main>
        {view.kind === 'new' && <NewRun onStarted={(job) => setView({ kind: 'job', id: job.id })} />}
        {view.kind === 'job' && <JobView id={view.id} />}
        {view.kind === 'trend' && <Trend />}
        {view.kind === 'runs' && selected.length === 0 && <p className="muted">Tick a run to see it, or two or more to compare them.</p>}
        {view.kind === 'runs' && selected.length === 1 && <RunDetail id={selected[0]} />}
        {view.kind === 'runs' && selected.length > 1 && <Compare ids={selected} />}
      </main>
    </div>
  )
}
