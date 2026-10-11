import { describe, expect, it } from 'vitest'
import { buildArgs, validateOptions } from './args'

const base = { name: 'before index', suite: 'backend', profile: 'typical', only: ['portfolio.holdings'], samples: 30, warmups: 3, repeat: 1, diagnostics: false, concurrency: null, overrides: {} }

describe('validateOptions', () => {
  it('accepts a normal launch', () => {
    expect(validateOptions(base)).toEqual(base)
  })
  it.each([
    [{ name: '  ' }, 'name'],
    [{ suite: 'gpu' }, 'suite'],
    [{ only: [] }, 'benchmark'],
    [{ samples: 0 }, 'samples'],
    [{ warmups: -1 }, 'warmups'],
    [{ repeat: 1.5 }, 'repeat'],
    [{ concurrency: 0 }, 'concurrency'],
    [{ overrides: { transactions: 0 } }, 'transactions'],
    [{ overrides: { bogus: 3 } }, 'bogus'],
    [{ only: ['a,b'] }, 'benchmark'],
  ])('rejects %o', (patch, word) => {
    expect(() => validateOptions({ ...base, ...patch })).toThrow(word)
  })
})

describe('buildArgs', () => {
  it('maps options to runner flags', () => {
    const o = validateOptions({ ...base, only: ['a', 'b'], diagnostics: true, concurrency: 4, overrides: { transactions: 20000, 'snapshot-stride': 7 } })
    expect(buildArgs(o, '/r/x.json')).toEqual([
      'run', '--suite', 'backend', '--profile', 'typical', '--only', 'a,b',
      '--samples', '30', '--warmups', '3', '--repeat', '1',
      '--concurrency', '4', '--transactions', '20000', '--snapshot-stride', '7',
      '--diagnostics', '--progress', '--save', '/r/x.json',
    ])
  })
})
