export type Suite = 'backend' | 'http' | 'browser' | 'load'
export const SUITES: Suite[] = ['backend', 'http', 'browser', 'load']

// CLI size overrides (`--<name> <n>`).
export const OVERRIDES = [
  'accounts', 'connections', 'holdings', 'days', 'transactions', 'lots',
  'users', 'snapshot-stride', 'price-stride', 'categories', 'tags',
] as const
export type Override = (typeof OVERRIDES)[number]

export interface RunOptions {
  name: string
  suite: Suite
  profile: string
  only: string[]
  samples: number
  warmups: number
  repeat: number
  diagnostics: boolean
  concurrency: number | null
  overrides: Partial<Record<Override, number>>
}

// Mirrors backend/bench/src/report.rs (schema_version 1).
export interface Measurement {
  id: string
  parameters: unknown
  boundary: string
  reset: string
  first_ms: number | null
  samples_ms: number[]
  batch_size: number
  reset_ms: number
  rows: number
  outcome: unknown
  correct: boolean
  errors: string[]
  diagnostics: Record<string, unknown>
}
export interface RunReport {
  id: string
  commit: string
  dirty_fingerprint: string
  timestamp: string
  environment: Record<string, unknown>
  fixture: Record<string, unknown>
  fixture_fingerprint: string
  suite: string
  warmups: number
  measurements: Measurement[]
  errors: string[]
}
export interface RunSet {
  schema_version: 1
  runs: RunReport[]
}

export interface Label {
  name: string
  note: string
  created_at: string
  status: 'ok' | 'failed'
}
export interface RunSummary {
  id: string
  name: string
  note: string
  createdAt: string
  suite: string | null
  profile: string | null
  fixtureFingerprint: string | null
  commit: string | null
  failed: boolean
  benchmarks: string[]
  error: string | null
}

export interface Target {
  id: string
  suite: string
  boundary: string
  reset: string
}
export interface Catalog {
  defaults: { samples: number; warmups: number; repeat: number }
  profiles: Array<Record<string, unknown> & { profile: string }>
  targets: Target[]
}

export type TrialKind = 'first' | 'warmup' | 'sample'
export type ProgressEvent =
  | { type: 'start'; cases: string[]; repeat: number; warmups: number; samples: number }
  | { type: 'manifest'; path: string }
  | { type: 'phase'; name: 'frontend_build' | 'seeding' | 'cleanup' }
  | { type: 'repeat'; index: number; of: number }
  | { type: 'case_start'; id: string; index: number; of: number }
  | { type: 'trial'; id: string; kind: TrialKind; n: number; of: number }
  | { type: 'case_end'; id: string; correct: boolean; median_ms: number | null; p95_ms: number | null; errors: string[] }
  | { type: 'done'; ok: boolean }

export type JobStatus = 'queued' | 'running' | 'saved' | 'failed' | 'cancelled'
export type Phase = 'compiling' | 'frontend_build' | 'seeding' | 'measuring' | 'cleanup'
export interface CaseResult {
  id: string
  repeat: number
  correct: boolean
  medianMs: number | null
  p95Ms: number | null
  errors: string[]
}
export interface Job {
  id: string
  options: RunOptions
  status: JobStatus
  phase: Phase | null
  cases: string[]
  repeat: { index: number; of: number }
  current: { id: string; index: number; of: number; kind: TrialKind | null; n: number; total: number } | null
  finished: CaseResult[]
  manifests: string[]
  log: string[]
  error: string | null
  resultId: string | null
  startedAt: string | null
  endedAt: string | null
}

export interface Health {
  database: { ok: boolean; source: 'env' | 'docker' | null; error: string | null }
}
export interface CompareResult {
  compatible: boolean
  reasons: string[]
}
