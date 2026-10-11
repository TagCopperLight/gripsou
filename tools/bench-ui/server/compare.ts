import { execFile } from 'node:child_process'
import type { CompareResult } from '../shared/types'

/** Runs `scripts/bench compare a b`: exit 0 compatible, 1 incompatible, else an error. */
export function compareRuns(command: string[], cwd: string, a: string, b: string): Promise<CompareResult> {
  const [program, ...prefix] = command
  return new Promise((resolve) => {
    execFile(program, [...prefix, 'compare', a, b], { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (error as { code?: number }).code : 0
      if (code === 0 || code === 1) {
        try {
          const out = JSON.parse(stdout)
          return resolve({ compatible: out.compatible === true, reasons: out.reasons ?? [] })
        } catch {
          /* fall through */
        }
      }
      const lines = stderr.trim().split('\n').filter((l) => l && !l.startsWith('   Compiling') && !l.startsWith('    Finished') && !l.startsWith('     Running'))
      resolve({ compatible: false, reasons: [lines.at(-1) ?? `compare failed (exit ${code})`] })
    })
  })
}
