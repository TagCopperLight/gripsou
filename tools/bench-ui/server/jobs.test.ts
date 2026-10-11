import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Job, RunOptions } from '../shared/types'
import { JobManager } from './jobs'
import { PendingCleanup } from './pending'
import { ResultStore } from './results'

const fake = fileURLToPath(new URL('./fixtures/fake-bench.mjs', import.meta.url))
const options: RunOptions = { name: 'try', suite: 'backend', profile: 'smoke', only: ['a'], samples: 1, warmups: 0, repeat: 1, diagnostics: false, concurrency: null, overrides: {} }

let dir: string
let store: ResultStore
let pending: PendingCleanup
let snapshots: Job[][]
const manager = (env: Record<string, string> = {}) => {
  Object.assign(process.env, { FAKE_EXIT: '0', FAKE_HANG: '0' }, env)
  return new JobManager({
    command: [process.execPath, fake], cwd: dir, store, pending,
    databaseUrl: async () => 'postgres://x', onChange: (jobs) => snapshots.push(jobs),
  })
}
const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
  expect(cond()).toBe(true)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bench-jobs-'))
  store = new ResultStore(join(dir, 'results'))
  pending = new PendingCleanup(join(dir, 'results', '.pending-cleanup.json'))
  snapshots = []
})

describe('JobManager', () => {
  it('runs a job to a saved, labelled result', async () => {
    const m = manager()
    const job = m.enqueue(options)
    await m.idle()
    const done = m.list().find((j) => j.id === job.id)!
    expect(done.status).toBe('saved')
    expect(done.finished).toHaveLength(1)
    expect(done.log).toContain('a: 1 samples verified')
    expect(done.log).toContain('compiling noise on stdout')
    expect(done.log.some((l) => l.startsWith('@progress'))).toBe(false)
    const [summary] = await store.list()
    expect(summary).toMatchObject({ id: done.resultId, name: 'try', failed: false })
    expect(await pending.all()).toEqual([])
    expect(snapshots.some((s) => s[0]?.phase === 'compiling')).toBe(true)
  })

  it('saves a run with failed benchmarks (exit 1) as failed', async () => {
    const m = manager({ FAKE_EXIT: '1' })
    m.enqueue(options)
    await m.idle()
    expect(m.list()[0].status).toBe('saved')
    expect((await store.list())[0]).toMatchObject({ failed: true })
    expect((await store.read((await store.list())[0].id)).label?.status).toBe('failed')
  })

  it('fails without saving on exit 2', async () => {
    const m = manager({ FAKE_EXIT: '2' })
    m.enqueue(options)
    await m.idle()
    expect(m.list()[0]).toMatchObject({ status: 'failed', resultId: null })
    expect(m.list()[0].error).toMatch(/exit code 2/)
    expect(await store.list()).toEqual([])
  })

  it('queues: one job at a time', async () => {
    const m = manager()
    m.enqueue(options)
    m.enqueue({ ...options, name: 'second' })
    expect(m.list().map((j) => j.status)).toEqual(['running', 'queued'])
    await m.idle()
    expect(m.list().map((j) => j.status)).toEqual(['saved', 'saved'])
  })

  it('cancels a running job and cleans its databases', async () => {
    const m = manager({ FAKE_HANG: '1' })
    const job = m.enqueue(options)
    await waitFor(() => m.list()[0].manifests.length === 1)
    const manifest = m.list()[0].manifests[0]
    expect(await pending.all()).toEqual([manifest])
    expect(await m.cancel(job.id)).toBe(true)
    await m.idle()
    expect(m.list()[0].status).toBe('cancelled')
    expect(existsSync(`${manifest}.cleaned`)).toBe(true)
    expect(await pending.all()).toEqual([])
    expect(await store.list()).toEqual([])
  })

  it('cancels a queued job without running it', async () => {
    const m = manager({ FAKE_HANG: '1' })
    const first = m.enqueue(options)
    const second = m.enqueue(options)
    expect(await m.cancel(second.id)).toBe(true)
    expect(m.list().find((j) => j.id === second.id)!.status).toBe('cancelled')
    await m.cancel(first.id)
    await m.idle()
  })

  it('cleans manifests left by a previous server', async () => {
    await pending.add(join(dir, 'left.json'))
    await manager().cleanupLeftovers()
    expect(existsSync(join(dir, 'left.json.cleaned'))).toBe(true)
    expect(await pending.all()).toEqual([])
  })
})
