import { describe, expect, it } from 'vitest'
import { applyEvent, caseFraction, newJob, overallFraction, parseProgressLine } from './progress'
import type { ProgressEvent, RunOptions } from './types'

const options: RunOptions = {
  name: 'x', suite: 'backend', profile: 'smoke', only: [], samples: 2, warmups: 1,
  repeat: 2, diagnostics: false, concurrency: null, overrides: {},
}
const run = (events: ProgressEvent[]) => events.reduce(applyEvent, { ...newJob('j', options), status: 'running' as const, phase: 'compiling' as const })

describe('parseProgressLine', () => {
  it('reads prefixed JSON and ignores everything else', () => {
    expect(parseProgressLine('@progress {"type":"done","ok":true}')).toEqual({ type: 'done', ok: true })
    expect(parseProgressLine('portfolio.holdings: 30 samples verified')).toBeNull()
    expect(parseProgressLine('@progress {broken')).toBeNull()
    expect(parseProgressLine('@progress {"type":"unknown"}')).toBeNull()
  })
})

describe('applyEvent and fractions', () => {
  it('stays in compiling until the runner speaks', () => {
    const job = run([])
    expect(job.phase).toBe('compiling')
    expect(overallFraction(job)).toBe(0)
    expect(caseFraction(job)).toBeNull()
  })

  it('tracks cases, trials and repeats', () => {
    let job = run([
      { type: 'start', cases: ['a', 'b'], repeat: 2, warmups: 1, samples: 2 },
      { type: 'repeat', index: 1, of: 2 },
      { type: 'manifest', path: '/tmp/m1.json' },
      { type: 'phase', name: 'seeding' },
      { type: 'case_start', id: 'a', index: 1, of: 2 },
    ])
    expect(job.phase).toBe('measuring')
    expect(job.manifests).toEqual(['/tmp/m1.json'])
    expect(caseFraction(job)).toBeNull()
    job = applyEvent(job, { type: 'trial', id: 'a', kind: 'warmup', n: 1, of: 1 })
    // first + 1 warmup done out of 1 + 1 + 2 trials
    expect(caseFraction(job)).toBe(0.5)
    expect(overallFraction(job)).toBeCloseTo(0.5 / 4)
    job = applyEvent(job, { type: 'case_end', id: 'a', correct: true, median_ms: 3, p95_ms: 4, errors: [] })
    expect(job.current).toBeNull()
    expect(job.finished).toEqual([{ id: 'a', repeat: 1, correct: true, medianMs: 3, p95Ms: 4, errors: [] }])
    expect(overallFraction(job)).toBe(0.25)
    job = applyEvent(job, { type: 'repeat', index: 2, of: 2 })
    expect(job.repeat).toEqual({ index: 2, of: 2 })
    expect(job.phase).toBeNull()
  })

  it('is complete once saved', () => {
    expect(overallFraction({ ...run([]), status: 'saved' })).toBe(1)
  })
})
