import { caseFraction, overallFraction } from '../../shared/progress'
import type { Phase } from '../../shared/types'
import { cancelJob, useJobs } from '../api'
import { formatMs } from '../lib/runs'
import { ProgressBar } from './ProgressBar'

const PHASES: Record<Phase, string> = {
  compiling: 'Compiling the benchmark program…',
  frontend_build: 'Building the frontend…',
  seeding: 'Creating fake data…',
  measuring: 'Measuring',
  cleanup: 'Cleaning up temporary databases…',
}

export function JobView({ id }: { id: string }) {
  const job = useJobs().find((j) => j.id === id)
  if (!job) return <p className="muted">This job is no longer in memory. Its result, if saved, is in the run list.</p>
  const c = job.current
  const caseValue = caseFraction(job)
  const active = job.status === 'running' || job.status === 'queued'
  return (
    <div>
      <h1>{job.options.name}</h1>
      <p className="muted">
        {job.options.suite} · {job.options.profile} · {job.options.samples} samples, {job.options.warmups} warmups
        {job.options.repeat > 1 ? ` · ${job.options.repeat} repeats` : ''}
      </p>
      {job.status === 'queued' && <p>Waiting for the current run to finish.</p>}
      {job.status === 'failed' && <div className="error">{job.error}</div>}
      {job.status === 'cancelled' && <div className="warn">Cancelled.</div>}
      {job.status === 'saved' && <p className="good">Saved. Tick it in the sidebar to look at the results.</p>}
      {job.status === 'running' && (
        <>
          <div>
            Overall: {job.finished.length} of {job.cases.length * job.repeat.of || '?'} benchmarks
            {job.repeat.of > 1 && job.repeat.index > 0 ? ` (repeat ${job.repeat.index} of ${job.repeat.of})` : ''}
          </div>
          <ProgressBar value={job.cases.length ? overallFraction(job) : null} />
          <div>
            {job.phase === 'measuring' && c
              ? `${c.id} (${c.index} of ${c.of})${c.kind ? `: ${c.kind === 'first' ? 'first run' : `${c.kind} ${c.n}/${c.total}`}` : ''}`
              : PHASES[job.phase ?? 'compiling']}
          </div>
          <ProgressBar value={job.phase === 'measuring' && c ? caseValue : null} />
        </>
      )}
      {active && <button onClick={() => void cancelJob(job.id)}>Cancel</button>}
      {job.finished.length > 0 && (
        <>
          <h2>Finished</h2>
          <table>
            <thead><tr><th>Benchmark</th>{job.repeat.of > 1 && <th>Repeat</th>}<th>Median</th><th>p95</th><th></th></tr></thead>
            <tbody>
              {job.finished.map((f, i) => (
                <tr key={i} title={f.errors.join('\n')}>
                  <td>{f.id}</td>{job.repeat.of > 1 && <td>{f.repeat}</td>}
                  <td>{formatMs(f.medianMs)}</td><td>{formatMs(f.p95Ms)}</td>
                  <td>{f.correct ? <span className="good">✓</span> : <span className="bad">✗ {f.errors[0]}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <details open={job.status === 'failed'}>
        <summary>Runner output ({job.log.length} lines)</summary>
        <pre className="log">{job.log.join('\n')}</pre>
      </details>
    </div>
  )
}
