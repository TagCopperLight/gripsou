import { useState, type FormEvent } from 'react'
import { OVERRIDES, SUITES, type Job, type Override, type RunOptions, type Suite } from '../../shared/types'
import { startJob, useCatalog, useHealth } from '../api'
import { PROFILE_INFO, SUITE_INFO } from '../profiles'

export function NewRun({ onStarted }: { onStarted(job: Job): void }) {
  const catalog = useCatalog()
  const health = useHealth()
  const [name, setName] = useState('')
  const [suite, setSuite] = useState<Suite>('backend')
  const [profile, setProfile] = useState('typical')
  const [picked, setPicked] = useState<string[]>([])
  const [samples, setSamples] = useState(30)
  const [warmups, setWarmups] = useState(3)
  const [repeat, setRepeat] = useState(1)
  const [concurrency, setConcurrency] = useState('')
  const [diagnostics, setDiagnostics] = useState(false)
  const [overrides, setOverrides] = useState<Partial<Record<Override, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (catalog.isLoading) return <p className="muted">Loading the benchmark list (the first time compiles the runner, which can take a few minutes)…</p>
  if (catalog.error) return <div className="error">Could not list benchmarks: {catalog.error.message}</div>
  const targets = catalog.data!.targets.filter((t) => t.suite === suite)
  const profiles = catalog.data!.profiles.map((p) => p.profile)
  const db = health.data?.database
  const isInt = (v: number, min: number) => Number.isInteger(v) && v >= min
  const invalid =
    !isInt(samples, 1) || !isInt(repeat, 1) || !isInt(warmups, 0) ||
    (concurrency !== '' && !isInt(Number(concurrency), 1)) ||
    Object.values(overrides).some((v) => v !== undefined && v !== '' && !isInt(Number(v), 1))
  const allPicked = targets.length > 0 && targets.every((t) => picked.includes(t.id))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const sizes = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, Number(v)]))
    const options: RunOptions = {
      name, suite, profile, only: picked.filter((id) => targets.some((t) => t.id === id)),
      samples, warmups, repeat, diagnostics, concurrency: concurrency === '' ? null : Number(concurrency), overrides: sizes,
    }
    try {
      onStarted(await startJob(options))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>New run</h1>
      {db && !db.ok && <div className="error">{db.error}</div>}
      {error && <div className="error">{error}</div>}
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. before index" required size={40} />
      </label>
      <label className="field">
        <span>Group</span>
        <select value={suite} onChange={(e) => { setSuite(e.target.value as Suite); setPicked([]) }}>
          {SUITES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>{' '}
        <span className="muted">{SUITE_INFO[suite]}</span>
      </label>
      <label className="field">
        <span>Fake data</span>
        <select value={profile} onChange={(e) => setProfile(e.target.value)}>
          {profiles.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>{' '}
        <span className="muted">{PROFILE_INFO[profile] ?? ''}</span>
      </label>
      <div className="field">
        <span>Benchmarks ({picked.length} selected)</span>
        <div className="checklist">
          <label><input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? [] : targets.map((t) => t.id))} /> <b>Select all</b></label>
          {targets.map((t) => (
            <label key={t.id} title={t.boundary}>
              <input type="checkbox" checked={picked.includes(t.id)} onChange={() => setPicked(picked.includes(t.id) ? picked.filter((p) => p !== t.id) : [...picked, t.id])} /> {t.id}
            </label>
          ))}
        </div>
      </div>
      <details className="field">
        <summary>Advanced</summary>
        <div className="grid" style={{ marginTop: 8 }}>
          <label>Samples<br /><input type="number" min={1} value={samples} onChange={(e) => setSamples(Number(e.target.value))} /></label>
          <label>Warmups<br /><input type="number" min={0} value={warmups} onChange={(e) => setWarmups(Number(e.target.value))} /></label>
          <label>Repeat<br /><input type="number" min={1} value={repeat} onChange={(e) => setRepeat(Number(e.target.value))} /></label>
          <label>Concurrency<br /><input type="number" min={1} placeholder="5" value={concurrency} onChange={(e) => setConcurrency(e.target.value)} /></label>
          {OVERRIDES.map((k) => (
            <label key={k}>{k}<br /><input type="number" min={1} placeholder="profile" value={overrides[k] ?? ''} onChange={(e) => setOverrides({ ...overrides, [k]: e.target.value })} /></label>
          ))}
        </div>
        <label style={{ display: 'block', marginTop: 8 }}>
          <input type="checkbox" checked={diagnostics} onChange={(e) => setDiagnostics(e.target.checked)} /> Diagnostics (SQL counts, memory, query plan; extra pass outside the timings)
        </label>
      </details>
      {invalid && <p className="bad">Samples and repeat need whole numbers of at least 1, warmups a whole number of at least 0; concurrency and the size overrides must be empty or whole numbers of at least 1.</p>}
      <button className="primary" style={{ width: 'auto' }} disabled={busy || invalid || picked.length === 0 || !name.trim()}>Start</button>
    </form>
  )
}
