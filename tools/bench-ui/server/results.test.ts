import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ResultStore } from './results'

const runSet = (correct = true) => ({
  schema_version: 1,
  runs: [{
    id: 'r', commit: 'abc', dirty_fingerprint: 'x', timestamp: '2026-10-11T10:00:00Z', environment: {},
    fixture: { profile: 'smoke' }, fixture_fingerprint: 'fp', suite: 'backend', warmups: 3, errors: [],
    measurements: [{ id: 'a', correct, samples_ms: [1] }],
  }],
})

let dir: string
let store: ResultStore
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bench-ui-'))
  store = new ResultStore(dir)
})

describe('ResultStore', () => {
  it('makes safe, sortable ids', () => {
    expect(store.newId('Before index!', new Date('2026-10-11T10:20:30Z'))).toBe('20261011-102030-before-index')
    expect(() => store.pathFor('../etc')).toThrow()
  })

  it('lists labelled, unlabelled and unreadable files', async () => {
    await writeFile(join(dir, 'b.json'), JSON.stringify(runSet()))
    await store.writeLabel('b', { name: 'before', note: '', created_at: '2026-10-11T10:00:00Z', status: 'ok' })
    await writeFile(join(dir, 'cli.json'), JSON.stringify(runSet(false)))
    await writeFile(join(dir, 'bad.json'), '{nope')
    const list = await store.list()
    const byId = Object.fromEntries(list.map((s) => [s.id, s]))
    expect(byId.b).toMatchObject({ name: 'before', suite: 'backend', profile: 'smoke', fixtureFingerprint: 'fp', failed: false, benchmarks: ['a'], error: null })
    expect(byId.cli).toMatchObject({ name: 'cli', failed: true })
    expect(byId.bad.error).toMatch(/JSON/)
    expect(list.some((s) => s.id.endsWith('.label'))).toBe(false)
  })

  it('renames and deletes both files', async () => {
    await writeFile(join(dir, 'b.json'), JSON.stringify(runSet()))
    await store.update('b', { name: 'renamed', note: 'n' })
    expect((await store.read('b')).label).toMatchObject({ name: 'renamed', note: 'n' })
    await store.remove('b')
    expect(await readdir(dir)).toEqual([])
  })
})
