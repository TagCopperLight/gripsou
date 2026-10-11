import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Label, RunSet, RunSummary } from '../shared/types'

const ID = /^[A-Za-z0-9._-]+$/

export class ResultStore {
  constructor(private dir: string) {}

  newId(name: string, now = new Date()): string {
    const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    return slug ? `${stamp}-${slug}` : stamp
  }

  pathFor(id: string): string {
    if (!ID.test(id) || id.startsWith('.')) throw new Error(`invalid run id ${id}`)
    return join(this.dir, `${id}.json`)
  }

  private labelPath(id: string): string {
    return this.pathFor(id).replace(/\.json$/, '.label.json')
  }

  private async label(id: string): Promise<Label | null> {
    try {
      return JSON.parse(await readFile(this.labelPath(id), 'utf8')) as Label
    } catch {
      return null
    }
  }

  async read(id: string): Promise<{ set: RunSet; label: Label | null }> {
    const set = JSON.parse(await readFile(this.pathFor(id), 'utf8')) as RunSet
    if (set.schema_version !== 1 || !Array.isArray(set.runs) || set.runs.length === 0) {
      throw new Error('not a schema v1 benchmark result')
    }
    return { set, label: await this.label(id) }
  }

  async list(): Promise<RunSummary[]> {
    await mkdir(this.dir, { recursive: true })
    const ids = (await readdir(this.dir))
      .filter((f) => f.endsWith('.json') && !f.endsWith('.label.json') && !f.startsWith('.'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter((id) => ID.test(id))
    const summaries = await Promise.all(ids.map((id) => this.summarize(id)))
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  private async summarize(id: string): Promise<RunSummary> {
    const label = await this.label(id)
    const empty: RunSummary = {
      id, name: label?.name ?? id, note: label?.note ?? '', createdAt: label?.created_at ?? '',
      suite: null, profile: null, fixtureFingerprint: null, commit: null, failed: true, benchmarks: [], error: null,
    }
    try {
      const { set } = await this.read(id)
      const first = set.runs[0]
      return {
        ...empty,
        createdAt: label?.created_at ?? first.timestamp,
        suite: first.suite,
        profile: typeof first.fixture?.profile === 'string' ? first.fixture.profile : null,
        fixtureFingerprint: first.fixture_fingerprint,
        commit: first.commit,
        failed: set.runs.some((r) => r.errors.length > 0 || r.measurements.some((m) => !m.correct)),
        benchmarks: [...new Set(set.runs.flatMap((r) => r.measurements.map((m) => m.id)))],
      }
    } catch (e) {
      const msg = e instanceof SyntaxError ? `invalid JSON: ${e.message}` : (e as Error).message
      return { ...empty, error: msg }
    }
  }

  async writeLabel(id: string, label: Label): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.labelPath(id), JSON.stringify(label, null, 2))
  }

  async update(id: string, patch: { name?: string; note?: string }): Promise<void> {
    const current = (await this.label(id)) ?? { name: id, note: '', created_at: new Date().toISOString(), status: 'ok' as const }
    const name = patch.name?.trim()
    await this.writeLabel(id, { ...current, ...(name ? { name } : {}), ...(patch.note !== undefined ? { note: patch.note } : {}) })
  }

  async remove(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true })
    await rm(this.labelPath(id), { force: true })
  }
}
