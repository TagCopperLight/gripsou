import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Catalog, Job } from '../shared/types'
import { validateOptions } from './args'
import { compareRuns } from './compare'
import { reachable, resolveDatabaseUrl } from './database'
import { JobManager } from './jobs'
import { BENCH_COMMAND, REPO_ROOT, RESULTS_DIR } from './paths'
import { PendingCleanup } from './pending'
import { ResultStore } from './results'

const PORT = 5174
const DIST = join(import.meta.dir, '..', 'dist')
const store = new ResultStore(RESULTS_DIR)
const pending = new PendingCleanup(join(RESULTS_DIR, '.pending-cleanup.json'))
const listeners = new Set<(jobs: Job[]) => void>()
const databaseUrl = async () => (await resolveDatabaseUrl(process.env)).url
const jobs = new JobManager({
  command: BENCH_COMMAND, cwd: REPO_ROOT, store, pending, databaseUrl,
  onChange: (list) => listeners.forEach((l) => l(list)),
})

let catalog: Promise<Catalog> | null = null
function loadCatalog(): Promise<Catalog> {
  catalog ??= promisify(execFile)(BENCH_COMMAND[0], ['list', '--json'], { cwd: REPO_ROOT, maxBuffer: 8 * 1024 * 1024 })
    .then(({ stdout }) => JSON.parse(stdout) as Catalog)
    .catch((e) => {
      catalog = null
      throw e
    })
  return catalog
}

const json = (body: unknown, status = 200) => Response.json(body, { status })
const fail = (e: unknown, status = 400) => json({ error: (e as Error).message }, status)

function events(): Response {
  let send: (jobs: Job[]) => void
  let ping: ReturnType<typeof setInterval>
  const stream = new ReadableStream<string>({
    start(controller) {
      send = (list) => controller.enqueue(`event: jobs\ndata: ${JSON.stringify(list)}\n\n`)
      listeners.add(send)
      send(jobs.list())
      ping = setInterval(() => controller.enqueue(': ping\n\n'), 15000)
    },
    cancel() {
      listeners.delete(send)
      clearInterval(ping)
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

await jobs.cleanupLeftovers()

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 0, // SSE connections stay open
  routes: {
    '/api/catalog': { GET: () => loadCatalog().then(json, (e) => fail(e, 500)) },
    '/api/health': {
      GET: async () => {
        try {
          const { url, source } = await resolveDatabaseUrl(process.env)
          const error = await reachable(url)
          return json({ database: { ok: error === null, source, error } })
        } catch (e) {
          return json({ database: { ok: false, source: null, error: (e as Error).message } })
        }
      },
    },
    '/api/runs': { GET: () => store.list().then(json) },
    '/api/runs/:id': {
      GET: (req) => store.read(req.params.id).then(json, (e) => fail(e, 404)),
      PATCH: async (req) => {
        try {
          await store.update(req.params.id, await req.json())
          return new Response(null, { status: 204 })
        } catch (e) {
          return fail(e)
        }
      },
      DELETE: (req) => store.remove(req.params.id).then(() => new Response(null, { status: 204 }), fail),
    },
    '/api/jobs': {
      POST: async (req) => {
        try {
          return json(jobs.enqueue(validateOptions(await req.json())))
        } catch (e) {
          return fail(e)
        }
      },
    },
    '/api/jobs/:id': {
      DELETE: async (req) => new Response(null, { status: (await jobs.cancel(req.params.id)) ? 204 : 404 }),
    },
    '/api/compare': {
      POST: async (req) => {
        try {
          const { reference, others } = (await req.json()) as { reference: string; others: string[] }
          const pairs = await Promise.all(
            others.map(async (id) => [id, await compareRuns(BENCH_COMMAND, REPO_ROOT, store.pathFor(reference), store.pathFor(id))] as const),
          )
          return json(Object.fromEntries(pairs))
        } catch (e) {
          return fail(e)
        }
      },
    },
    '/api/events': { GET: events },
  },
  async fetch(req) {
    const path = new URL(req.url).pathname
    const file = Bun.file(join(DIST, path === '/' ? 'index.html' : path))
    if (!path.includes('..') && (await file.exists())) return new Response(file)
    const index = Bun.file(join(DIST, 'index.html'))
    return (await index.exists()) ? new Response(index) : new Response('run `bun run build` first', { status: 404 })
  },
})

// Ctrl-C / kill: stop the detached runner and clean its fixtures before exiting.
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return
    stopping = true
    await jobs.shutdown()
    process.exit(0)
  })
}

console.log(`bench-ui on http://127.0.0.1:${PORT}`)
