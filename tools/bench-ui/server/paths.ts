import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
export const RESULTS_DIR = join(REPO_ROOT, 'benchmarks', 'results')
export const BENCH_COMMAND = [join(REPO_ROOT, 'scripts', 'bench')]
