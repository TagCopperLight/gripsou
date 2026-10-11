import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compareRuns } from './compare'

const command = [process.execPath, fileURLToPath(new URL('./fixtures/fake-bench.mjs', import.meta.url))]

describe('compareRuns', () => {
  it('passes through compatible and incompatible verdicts', async () => {
    expect(await compareRuns(command, '.', 'a', 'a')).toEqual({ compatible: true, reasons: [] })
    expect(await compareRuns(command, '.', 'a', 'b')).toEqual({ compatible: false, reasons: ['run 0: different environment cpu'] })
  })
  it('turns a runner error into a reason', async () => {
    expect(await compareRuns(command, '.', 'broken', 'b')).toEqual({ compatible: false, reasons: ['different number of independent runs'] })
  })
})
