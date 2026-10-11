import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Scratch-database manifests of runs this server started and has not seen finish. */
export class PendingCleanup {
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private file: string) {}

  async all(): Promise<string[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as string[]
    } catch {
      return []
    }
  }

  private edit(f: (paths: string[]) => string[]): Promise<void> {
    const next = this.chain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(this.file, JSON.stringify(f(await this.all())))
    })
    this.chain = next.catch(() => {})
    return next
  }

  add(path: string) {
    return this.edit((p) => (p.includes(path) ? p : [...p, path]))
  }

  remove(path: string) {
    return this.edit((p) => p.filter((x) => x !== path))
  }
}
