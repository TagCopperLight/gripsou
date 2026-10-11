import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args[0] === 'cleanup') {
  writeFileSync(`${args[1]}.cleaned`, '')
  process.exit(0)
}
if (args[0] === 'compare') {
  if (args[1].includes('broken')) {
    process.stderr.write('different number of independent runs\n')
    process.exit(2)
  }
  const ok = args[1] === args[2]
  console.log(JSON.stringify({ compatible: ok, reasons: ok ? [] : ['run 0: different environment cpu'], changes: [] }))
  process.exit(ok ? 0 : 1)
}
const flag = (name) => args[args.indexOf(name) + 1]
const save = flag('--save')
const ev = (e) => process.stderr.write(`@progress ${JSON.stringify(e)}\n`)
const manifest = `${save}.manifest`
writeFileSync(manifest, '{}') // the real runner creates its cleanup record too

console.log('compiling noise on stdout')
ev({ type: 'start', cases: ['a'], repeat: 1, warmups: 0, samples: 1 })
ev({ type: 'repeat', index: 1, of: 1 })
ev({ type: 'manifest', path: manifest })
if (process.env.FAKE_HANG === '1') {
  setInterval(() => {}, 1000)
} else {
  ev({ type: 'case_start', id: 'a', index: 1, of: 1 })
  ev({ type: 'trial', id: 'a', kind: 'first', n: 1, of: 1 })
  ev({ type: 'trial', id: 'a', kind: 'sample', n: 1, of: 1 })
  ev({ type: 'case_end', id: 'a', correct: true, median_ms: 1, p95_ms: 1, errors: [] })
  process.stderr.write('a: 1 samples verified\n')
  const code = Number(process.env.FAKE_EXIT ?? 0)
  if (code !== 2) {
    writeFileSync(save, JSON.stringify({
      schema_version: 1,
      runs: [{ id: 'r', commit: 'c', dirty_fingerprint: 'd', timestamp: '2026-10-11T00:00:00Z', environment: {}, fixture: { profile: 'smoke' }, fixture_fingerprint: 'f', suite: 'backend', warmups: 0, errors: [], measurements: [{ id: 'a', correct: code === 0, samples_ms: [1] }] }],
    }))
  }
  ev({ type: 'done', ok: code === 0 })
  process.exit(code)
}
