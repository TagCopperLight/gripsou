import type { BunRequest } from 'bun'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Catalog, Job } from '../shared/types'
import { validateOptions } from './args'
import { compareRuns } from './compare'
import { guardStatus, checkRequest } from './guard'
import { hostOf, reachable, resolveDatabaseUrl } from './database'
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
  const [program, ...prefix] = BENCH_COMMAND
  catalog ??= promisify(execFile)(program, [...prefix, 'list', '--json'], { cwd: REPO_ROOT, maxBuffer: 8 * 1024 * 1024 })
    .then(({ stdout }) => JSON.parse(stdout) as Catalog)
    .catch((e) => {
      catalog = null
      throw e
    })
  return catalog
}

const json = (body: unknown, status = 200) => Response.json(body, { status })
const fail = (e: unknown, status = 400) => json({ error: (e as Error).message }, status)

function events(req: Request): Response {
  let send: ((jobs: Job[]) => void) | undefined
  let ping: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    if (send) listeners.delete(send)
    send = undefined
    clearInterval(ping)
  }
  const stream = new ReadableStream<string>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(chunk)
        } catch {
          stop() // the stream was closed without a cancel
        }
      }
      send = (list) => write(`event: jobs\ndata: ${JSON.stringify(list)}\n\n`)
      listeners.add(send)
      send(jobs.list())
      ping = setInterval(() => write(': ping\n\n'), 15000)
      req.signal.addEventListener('abort', stop)
    },
    cancel: stop,
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

type Handler = (req: BunRequest<string>) => Response | Promise<Response>
/** Wraps every handler of an /api route in the local-only request guard. */
function guarded(handlers: Record<string, Handler>): Record<string, Handler> {
  return Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      (req: BunRequest<string>) => {
        const error = checkRequest(req.method, req.headers)
        return error ? json({ error }, guardStatus(error)) : handler(req)
      },
    ]),
  )
}

await jobs.cleanupLeftovers()

const api: Record<string, Record<string, Handler>> = {
  '/api/catalog': { GET: () => loadCatalog().then(json, (e) => fail(e, 500)) },
  '/api/health': {
    GET: async () => {
      try {
        const { url, source } = await resolveDatabaseUrl(process.env)
        const error = await reachable(url)
        return json({ database: { ok: error === null, source, host: hostOf(url), error } })
      } catch (e) {
        return json({ database: { ok: false, source: null, host: null, error: (e as Error).message } })
      }
    },
  },
  '/api/runs': {
    GET: async () => {
      const hidden = jobs.activeResultIds() // the runner rewrites its file after every repeat
      return json((await store.list()).filter((r) => !hidden.has(r.id)))
    },
  },
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
        const body = (await req.json()) as { reference?: unknown; others?: unknown }
        if (typeof body.reference !== 'string' || !Array.isArray(body.others) || !body.others.every((o) => typeof o === 'string')) {
          return fail(new Error('reference must be a string and others an array of strings'))
        }
        const { reference, others } = body as { reference: string; others: string[] }
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
}

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 0, // SSE connections stay open
  routes: Object.fromEntries(Object.entries(api).map(([path, handlers]) => [path, guarded(handlers)])),
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
    if (stopping) process.exit(1) // second signal: give up waiting
    stopping = true
    try {
      await jobs.shutdown()
    } catch (e) {
      console.error(e)
    } finally {
      process.exit(0)
    }
  })
}

console.log(`bench-ui on http://127.0.0.1:${PORT}`)
