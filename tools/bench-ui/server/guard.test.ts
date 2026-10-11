import { describe, expect, it } from 'vitest'
import { checkRequest, guardStatus } from './guard'

const h = (o: Record<string, string>) => new Headers(o)
const json = { 'content-type': 'application/json' }

describe('checkRequest', () => {
  it('accepts local hosts', () => {
    expect(checkRequest('GET', h({ host: '127.0.0.1:5174' }))).toBeNull()
    expect(checkRequest('GET', h({ host: 'localhost:5174' }))).toBeNull()
  })
  it('rejects other hosts (DNS rebinding)', () => {
    expect(checkRequest('GET', h({ host: 'evil.example:5174' }))).toMatch(/Host/)
    expect(checkRequest('GET', h({}))).toMatch(/Host/)
  })
  it('rejects foreign origins, allows ours and the dev server', () => {
    expect(checkRequest('GET', h({ host: '127.0.0.1:5174', origin: 'https://evil.example' }))).toMatch(/cross-site/)
    expect(checkRequest('GET', h({ host: '127.0.0.1:5174', origin: 'null' }))).toMatch(/cross-site/)
    for (const origin of ['http://127.0.0.1:5174', 'http://localhost:5174', 'http://localhost:5175', 'http://127.0.0.1:5175']) {
      expect(checkRequest('GET', h({ host: '127.0.0.1:5174', origin }))).toBeNull()
    }
  })
  it('requires JSON on POST and PATCH only', () => {
    const host = { host: '127.0.0.1:5174' }
    expect(checkRequest('POST', h(host))).toMatch(/content-type/)
    expect(checkRequest('PATCH', h({ ...host, 'content-type': 'text/plain' }))).toMatch(/content-type/)
    expect(checkRequest('POST', h({ ...host, ...json }))).toBeNull()
    expect(checkRequest('PATCH', h({ ...host, 'content-type': 'application/json; charset=utf-8' }))).toBeNull()
    expect(checkRequest('DELETE', h(host))).toBeNull()
  })
  it('maps errors to statuses', () => {
    expect(guardStatus('content-type must be application/json')).toBe(415)
    expect(guardStatus('unexpected Host header')).toBe(403)
  })
})
