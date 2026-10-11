import type { Job, ProgressEvent, RunOptions } from './types'

export const PREFIX = '@progress '
const TYPES = new Set(['start', 'manifest', 'phase', 'repeat', 'case_start', 'trial', 'case_end', 'done'])

export function parseProgressLine(line: string): ProgressEvent | null {
  if (!line.startsWith(PREFIX)) return null
  try {
    const ev = JSON.parse(line.slice(PREFIX.length))
    return ev && TYPES.has(ev.type) ? (ev as ProgressEvent) : null
  } catch {
    return null
  }
}

export function newJob(id: string, options: RunOptions): Job {
  return {
    id, options, status: 'queued', phase: null, cases: [],
    repeat: { index: 0, of: options.repeat }, current: null, finished: [],
    manifests: [], log: [], error: null, resultId: null, startedAt: null, endedAt: null,
  }
}

export function applyEvent(job: Job, ev: ProgressEvent): Job {
  switch (ev.type) {
    case 'start':
      return { ...job, cases: ev.cases, repeat: { index: 0, of: ev.repeat } }
    case 'manifest':
      return { ...job, manifests: [...job.manifests, ev.path] }
    case 'phase':
      return { ...job, phase: ev.name }
    case 'repeat':
      return { ...job, repeat: { index: ev.index, of: ev.of }, phase: null, current: null }
    case 'case_start':
      return { ...job, phase: 'measuring', current: { id: ev.id, index: ev.index, of: ev.of, kind: null, n: 0, total: 0 } }
    case 'trial':
      return job.current ? { ...job, current: { ...job.current, kind: ev.kind, n: ev.n, total: ev.of } } : job
    case 'case_end':
      return {
        ...job,
        current: null,
        finished: [...job.finished, {
          id: ev.id, repeat: job.repeat.index, correct: ev.correct,
          medianMs: ev.median_ms, p95Ms: ev.p95_ms, errors: ev.errors,
        }],
      }
    case 'done':
      return job
  }
}

/** Share of the current benchmark's trials done, or null when unknown (browser cases). */
export function caseFraction(job: Job): number | null {
  const c = job.current
  if (!c || !c.kind) return null
  const { warmups, samples } = job.options
  const done = c.kind === 'first' ? 1 : c.kind === 'warmup' ? 1 + c.n : 1 + warmups + c.n
  return done / (1 + warmups + samples)
}

export function overallFraction(job: Job): number {
  if (job.status === 'saved') return 1
  const total = job.cases.length * job.repeat.of
  if (total === 0) return 0
  return Math.min(1, (job.finished.length + (caseFraction(job) ?? 0)) / total)
}
