import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { applyEvent, newJob, parseProgressLine } from '../shared/progress'
import type { Job, RunOptions } from '../shared/types'
import { buildArgs } from './args'
import type { PendingCleanup } from './pending'
import type { ResultStore } from './results'

export interface JobDeps {
  command: string[]
  cwd: string
  store: ResultStore
  pending: PendingCleanup
  databaseUrl: () => Promise<string>
  onChange: (jobs: Job[]) => void
}

const LOG_LINES = 200
const KEEP_FINISHED = 20
const DRAIN_MS = 2000

export class JobManager {
  private jobs: Job[] = []
  private child: ChildProcess | null = null
  private running: Promise<void> | null = null
  private cancelled = new Set<string>()
  private counter = 0
  private stopping = false

  constructor(private deps: JobDeps) {}

  list(): Job[] {
    return this.jobs
  }

  enqueue(options: RunOptions): Job {
    const job = newJob(`job-${Date.now()}-${this.counter++}`, options)
    this.jobs = [...this.jobs, job]
    this.pump()
    this.emit()
    return this.jobs.find((j) => j.id === job.id)!
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.id === id)
    if (!job) return false
    if (job.status === 'queued') {
      this.set(id, { status: 'cancelled', endedAt: new Date().toISOString() })
      return true
    }
    if (job.status !== 'running') return false
    this.cancelled.add(id)
    if (!this.child?.pid) return true // not spawned yet: execute() checks the flag before spawning
    try {
      process.kill(-this.child.pid, 'SIGTERM') // whole group: cargo and the bench binary
    } catch {
      this.child.kill('SIGTERM')
    }
    return true
  }

  /** Stop for good: queued jobs are cancelled, the running one is terminated and cleaned up. */
  async shutdown(): Promise<void> {
    this.stopping = true
    const now = new Date().toISOString()
    this.jobs = this.jobs.map((j) => (j.status === 'queued' ? { ...j, status: 'cancelled', endedAt: now } : j))
    this.emit()
    const running = this.jobs.find((j) => j.status === 'running')
    if (running) await this.cancel(running.id)
    await this.idle()
  }

  async idle(): Promise<void> {
    while (this.running) await this.running
  }

  async cleanupLeftovers(): Promise<void> {
    for (const manifest of await this.deps.pending.all()) {
      await this.cleanup(manifest)
    }
  }

  private emit() {
    this.deps.onChange(this.jobs)
  }

  private set(id: string, patch: Partial<Job> | ((j: Job) => Job)) {
    this.jobs = this.jobs.map((j) => (j.id !== id ? j : typeof patch === 'function' ? patch(j) : { ...j, ...patch }))
    this.emit()
  }

  private pump() {
    if (this.running || this.stopping) return
    const next = this.jobs.find((j) => j.status === 'queued')
    if (!next) return
    this.running = this.execute(next.id).catch(() => {}).finally(() => {
      this.running = null
      this.trim()
      this.pump()
    })
  }

  private trim() {
    const finished = this.jobs.filter((j) => !['queued', 'running'].includes(j.status))
    const drop = new Set(finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)).map((j) => j.id))
    this.jobs = this.jobs.filter((j) => !drop.has(j.id))
  }

  private async execute(id: string): Promise<void> {
    try {
      await this.run(id)
    } catch (e) {
      this.child = null
      this.cancelled.delete(id)
      this.set(id, { status: 'failed', current: null, error: (e as Error).message, endedAt: new Date().toISOString() })
    }
  }

  private async run(id: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === id)!
    const resultId = this.deps.store.newId(job.options.name)
    const save = this.deps.store.pathFor(resultId)
    this.set(id, { status: 'running', phase: 'compiling', startedAt: new Date().toISOString() })
    let databaseUrl: string
    try {
      await mkdir(dirname(save), { recursive: true }) // the runner writes its manifest next to the result
      databaseUrl = await this.deps.databaseUrl()
    } catch (e) {
      this.set(id, { status: 'failed', error: (e as Error).message, endedAt: new Date().toISOString() })
      return
    }
    if (this.cancelled.has(id)) {
      this.cancelled.delete(id)
      this.set(id, { status: 'cancelled', current: null, endedAt: new Date().toISOString() })
      return
    }
    const [program, ...prefix] = this.deps.command
    const child = spawn(program, [...prefix, ...buildArgs(job.options, save)], {
      cwd: this.deps.cwd,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    const log = (line: string) => this.set(id, (j) => ({ ...j, log: [...j.log, line].slice(-LOG_LINES) }))
    const pendingAdds: Promise<void>[] = []
    const out = createInterface({ input: child.stdout! })
    const err = createInterface({ input: child.stderr! })
    out.on('line', log)
    err.on('line', (line) => {
      const ev = parseProgressLine(line)
      if (!ev) return log(line)
      if (ev.type === 'manifest') pendingAdds.push(this.deps.pending.add(ev.path).catch(() => {}))
      this.set(id, (j) => applyEvent(j, ev))
    })
    // Wait for the readers so trailing lines are not lost. A failed spawn never closes them
    // under Bun, and a stuck reader must not wedge the queue, so both cases are bounded.
    const drained = Promise.all([out, err].map((rl) => new Promise<void>((r) => rl.once('close', () => r()))))
    let spawnFailed = false
    const code = await new Promise<number | null>((resolve) => {
      child.on('error', (e) => {
        spawnFailed = true
        log(`could not start runner: ${e.message}`)
        resolve(null)
      })
      child.on('close', (c) => resolve(c))
    })
    if (!spawnFailed) await Promise.race([drained, new Promise((r) => setTimeout(r, DRAIN_MS))])
    out.close()
    err.close()
    await Promise.all(pendingAdds)
    this.child = null
    const endedAt = new Date().toISOString()
    const manifests = this.jobs.find((j) => j.id === id)!.manifests

    // Whatever the exit, a manifest still on disk means the runner did not clean up after itself.
    for (const m of manifests) await this.cleanup(m, databaseUrl, id)

    if (this.cancelled.has(id)) {
      this.cancelled.delete(id)
      await this.deps.store.remove(resultId)
      this.set(id, { status: 'cancelled', current: null, endedAt })
      return
    }
    if ((code === 0 || code === 1) && existsSync(save)) {
      await this.deps.store.writeLabel(resultId, { name: job.options.name, note: '', created_at: endedAt, status: code === 0 ? 'ok' : 'failed' })
      this.set(id, { status: 'saved', resultId, current: null, endedAt })
    } else {
      await rm(save, { force: true })
      this.set(id, { status: 'failed', current: null, error: `runner stopped with exit code ${code ?? 'none'}`, endedAt })
    }
  }

  /** Runs the runner's `cleanup`; the manifest stays pending unless that succeeded (or it is gone). */
  private async cleanup(manifest: string, databaseUrl?: string, jobId?: string): Promise<void> {
    const note = (msg: string) => {
      if (jobId) this.set(jobId, (j) => ({ ...j, log: [...j.log, msg].slice(-LOG_LINES) }))
      else console.error(msg)
    }
    if (existsSync(manifest)) {
      const url = databaseUrl ?? (await this.deps.databaseUrl().catch(() => undefined))
      const [program, ...prefix] = this.deps.command
      const outcome = await new Promise<string | null>((resolve) => {
        const c = spawn(program, [...prefix, 'cleanup', manifest], {
          cwd: this.deps.cwd,
          env: { ...process.env, ...(url ? { DATABASE_URL: url } : {}) },
          stdio: 'ignore',
        })
        c.on('close', (code) => resolve(code === 0 ? null : `exit code ${code}`))
        c.on('error', (e) => resolve(e.message))
      })
      if (outcome) {
        note(`cleanup of ${manifest} failed (${outcome}); it will be retried at the next start`)
        return
      }
    }
    await this.deps.pending.remove(manifest)
  }
}
