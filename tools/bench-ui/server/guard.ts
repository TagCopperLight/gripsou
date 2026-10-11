const HOSTS = new Set(['127.0.0.1:5174', 'localhost:5174'])
const ORIGINS = new Set(['http://127.0.0.1:5174', 'http://localhost:5174', 'http://127.0.0.1:5175', 'http://localhost:5175'])

/** Local-only API guard against DNS rebinding and cross-site requests. Returns an error message, or null to let it through. */
export function checkRequest(method: string, headers: Pick<Headers, 'get'>): string | null {
  const host = headers.get('host')
  if (!host || !HOSTS.has(host.toLowerCase())) return 'unexpected Host header'
  const origin = headers.get('origin')
  if (origin !== null && !ORIGINS.has(origin.toLowerCase())) return 'cross-site request refused'
  if ((method === 'POST' || method === 'PATCH') && !/^application\/json\s*(;|$)/i.test(headers.get('content-type') ?? '')) {
    return 'content-type must be application/json'
  }
  return null
}

/** HTTP status for a guard error: 415 for the content type, 403 otherwise. */
export const guardStatus = (error: string) => (error.startsWith('content-type') ? 415 : 403)
