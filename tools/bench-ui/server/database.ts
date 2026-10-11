import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import { promisify } from 'node:util'

const CONTAINER = 'gripsou-postgres-1'

async function dockerInspect(): Promise<string> {
  const { stdout } = await promisify(execFile)('docker', [
    'inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', CONTAINER,
  ])
  return stdout
}

export async function resolveDatabaseUrl(
  env: Record<string, string | undefined>,
  inspect: () => Promise<string> = dockerInspect,
): Promise<{ url: string; source: 'env' | 'docker' }> {
  if (env.DATABASE_URL) return { url: env.DATABASE_URL, source: 'env' }
  const ip = await inspect().then((s) => s.trim(), () => '')
  if (!ip) {
    throw new Error(`no database: set DATABASE_URL before starting the interface, or start the ${CONTAINER} container (docker compose -f docker/docker-compose.yml up -d postgres)`)
  }
  return { url: `postgres://gripsou:gripsou@${ip}:5432/gripsou`, source: 'docker' }
}

/** hostname:port of a database URL, without any credentials. */
export function hostOf(url: string): string {
  const { hostname, port } = new URL(url)
  return `${hostname}:${port || 5432}`
}

/** Opens a TCP connection to the database host; null when it answers. */
export function reachable(url: string, timeoutMs = 2000): Promise<string | null> {
  const { hostname, port } = new URL(url)
  const where = `${hostname}:${port || 5432}`
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port || 5432) })
    const done = (reason: string | null) => {
      socket.destroy()
      resolve(reason)
    }
    socket.setTimeout(timeoutMs, () => done(`database at ${where} did not answer`))
    socket.once('connect', () => done(null))
    socket.once('error', () => done(`database at ${where} refused the connection`))
  })
}
