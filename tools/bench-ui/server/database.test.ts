import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { reachable, resolveDatabaseUrl } from './database'

describe('resolveDatabaseUrl', () => {
  it('prefers the shell variable', async () => {
    expect(await resolveDatabaseUrl({ DATABASE_URL: 'postgres://a' }, async () => 'unused')).toEqual({ url: 'postgres://a', source: 'env' })
  })
  it('falls back to the compose container IP', async () => {
    expect(await resolveDatabaseUrl({}, async () => '172.18.0.2\n')).toEqual({
      url: 'postgres://gripsou:gripsou@172.18.0.2:5432/gripsou', source: 'docker',
    })
  })
  it('explains when neither works', async () => {
    await expect(resolveDatabaseUrl({}, async () => { throw new Error('no such container') })).rejects.toThrow(/DATABASE_URL/)
    await expect(resolveDatabaseUrl({}, async () => '')).rejects.toThrow(/DATABASE_URL/)
  })
})

describe('reachable', () => {
  it('connects to a listening port and reports a closed one', async () => {
    const server = createServer().listen(0, '127.0.0.1')
    await new Promise((r) => server.once('listening', r))
    const port = (server.address() as { port: number }).port
    expect(await reachable(`postgres://u:p@127.0.0.1:${port}/db`)).toBeNull()
    server.close()
    await new Promise((r) => server.once('close', r))
    expect(await reachable(`postgres://u:p@127.0.0.1:${port}/db`)).toMatch(/127.0.0.1/)
  })
})
