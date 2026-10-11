import { OVERRIDES, SUITES, type Override, type RunOptions, type Suite } from '../shared/types'

function int(value: unknown, field: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new Error(`${field} must be a whole number ≥ ${min}`)
  }
  return value
}

export function validateOptions(raw: unknown): RunOptions {
  const o = (raw ?? {}) as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  if (!name) throw new Error('name is required')
  if (!SUITES.includes(o.suite as Suite)) throw new Error('unknown suite')
  if (typeof o.profile !== 'string' || !o.profile) throw new Error('profile is required')
  const only = o.only
  if (!Array.isArray(only) || only.length === 0 || !only.every((id) => typeof id === 'string' && /^[\w.-]+$/.test(id))) {
    throw new Error('pick at least one benchmark')
  }
  const overrides: Partial<Record<Override, number>> = {}
  for (const [key, value] of Object.entries((o.overrides ?? {}) as Record<string, unknown>)) {
    if (!OVERRIDES.includes(key as Override)) throw new Error(`unknown size override ${key}`)
    overrides[key as Override] = int(value, key, 1)
  }
  return {
    name,
    suite: o.suite as Suite,
    profile: o.profile,
    only: only as string[],
    samples: int(o.samples, 'samples', 1),
    warmups: int(o.warmups, 'warmups', 0),
    repeat: int(o.repeat, 'repeat', 1),
    diagnostics: o.diagnostics === true,
    concurrency: o.concurrency === null || o.concurrency === undefined ? null : int(o.concurrency, 'concurrency', 1),
    overrides,
  }
}

export function buildArgs(o: RunOptions, savePath: string): string[] {
  const args = [
    'run', '--suite', o.suite, '--profile', o.profile, '--only', o.only.join(','),
    '--samples', String(o.samples), '--warmups', String(o.warmups), '--repeat', String(o.repeat),
  ]
  if (o.concurrency !== null) args.push('--concurrency', String(o.concurrency))
  for (const key of OVERRIDES) {
    const value = o.overrides[key]
    if (value !== undefined) args.push(`--${key}`, String(value))
  }
  if (o.diagnostics) args.push('--diagnostics')
  args.push('--progress', '--save', savePath)
  return args
}
