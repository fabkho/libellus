// Closed-loop load test of the hottest endpoints, N members at once, each member its own JWT (members 2..N+1 of the
// S2 seed) asking the same endpoint back to back for `--seconds`. Throwaway stack only (the JWT secret is the CLI's local one).
//
//   API=http://127.0.0.1:55771 ANON_KEY=... node docs/perf/data/final/loadtest.mjs --levels 1,5,10,20,40,80 --seconds 8
//   ... --only finished,search            some endpoints
//   ... --mix                              the Home mix instead: 20 members each opening Home (6 parallel requests), back to back
//
// Prints, per endpoint and level: requests/s, p50, p95, p99, max, errors (non-2xx, timeouts) and the containers' CPU % (docker stats,
// sampled in the middle of the window) so a saturated service shows by name.
import { execFile } from 'node:child_process'
import { memberJwt } from '../../../../scripts/perf/jwt.mjs'

const API = process.env.API ?? 'http://127.0.0.1:55771'
const ANON = process.env.ANON_KEY ?? ''
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
const levels = arg('levels', '1,5,10,20,40').split(',').map(Number)
const seconds = Number(arg('seconds', '8'))
const only = arg('only', '').split(',').filter(Boolean)
const base = Number(arg('base', '2'))
const stackName = process.env.STACK ?? 'libellus-perf-final'

const LIST_BOOK = 'id,title,authors,isbn13,isbn10,page_count,published_year,language,publisher,cover_url,cover_thumbhash,cover_dominant,cover_secondary,source,apple_id,openlibrary_edition_key,openlibrary_work_key,created_at,format,goodreads:goodreads_rating(*)'
const ENTRY = `id,status,added_at,page_count_override,format_override,read_as,hidden,book:books!inner(${LIST_BOOK}),latest:latest_session(*)`
const SESSION = `id,entry_id,started_on,ended_on,outcome,rating,created_at,entry:library_entries!inner(page_count_override,book:books!inner(${LIST_BOOK}))`
const year = new Date().getFullYear()
const q = (o) => new URLSearchParams(o).toString()
const get = (path, headers = {}) => ({ method: 'GET', path, headers })
const rpc = (name, body) => ({ method: 'POST', path: `/rest/v1/rpc/${name}`, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const TERMS = ['book title 1', 'author 7 lastname', 'bo', 'the', 'book title 12345', 'author 42']

const ENDPOINTS = {
  finished: () => get(`/rest/v1/library_entries?${q({ select: ENTRY, status: 'eq.finished', order: 'latest(ended_on).desc.nullslast,added_at.desc,id' })}`, { range: '0-999', 'range-unit': 'items' }),
  readInYear: () => get(`/rest/v1/reading_sessions?${new URLSearchParams([['select', 'id'], ['outcome', 'eq.finished'], ['ended_on', `gte.${year}-01-01`], ['ended_on', `lte.${year}-12-31`]])}`, { prefer: 'count=exact', range: '0-0' }),
  started: () => rpc('started_and_muted_series', { p_limit: 50, p_language: 'en' }),
  search: (i) => rpc('search_books', { p_query: TERMS[i % TERMS.length], p_limit: 20 }),
  profile: () => get(`/rest/v1/reading_sessions?${q({ select: SESSION, outcome: 'not.is.null', order: 'id' })}`, { range: '0-999', 'range-unit': 'items' }),
  feed: () => rpc('feed', { p_before: null, p_before_id: null, p_limit: 30 }),
}
const HOME = () => [ENDPOINTS.finished(), ENDPOINTS.readInYear(), ENDPOINTS.started(), get(`/rest/v1/library_entries?${q({ select: ENTRY, status: 'eq.want_to_read', order: 'added_at.desc,id' })}`, { range: '0-999', 'range-unit': 'items' }), get(`/rest/v1/library_entries?${q({ select: ENTRY, status: 'eq.reading', order: 'latest(started_on).desc.nullslast,added_at.desc,id' })}`, { range: '0-999', 'range-unit': 'items' })]

async function call(token, r) {
  const t0 = performance.now()
  try {
    const res = await fetch(API + r.path, { method: r.method, body: r.body, headers: { apikey: ANON, authorization: `Bearer ${token}`, ...r.headers }, signal: AbortSignal.timeout(30_000) })
    await res.arrayBuffer()
    return { ms: performance.now() - t0, ok: res.status < 300 }
  } catch {
    return { ms: performance.now() - t0, ok: false }
  }
}
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : NaN)
// Asynchronous on purpose: `docker stats --no-stream` takes ~2 s and would stall this process's own event loop (and every request in flight).
const cpu = () =>
  new Promise((resolve) => {
    execFile('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}}'], (err, out) => {
      if (err) return resolve('')
      resolve(out.split('\n').filter((l) => l.includes(stackName) && /_(db|rest|kong|auth)_/.test(l)).map((l) => l.replace('supabase_', '').replace(`_${stackName}`, '')).join('  '))
    })
  })

async function level(name, n, work) {
  const tokens = Array.from({ length: n }, (_, i) => memberJwt(base + (i % 290)))
  const lat = []
  let errors = 0, count = 0
  const end = performance.now() + seconds * 1000
  const t0 = performance.now()
  let stats = ''
  setTimeout(async () => { stats = await cpu() }, (seconds * 1000) / 2 - 1500)
  await Promise.all(tokens.map(async (token, i) => {
    let k = 0
    while (performance.now() < end) {
      const t = performance.now()
      const out = await work(token, i + k++)
      lat.push(performance.now() - t)
      count++
      if (!out) errors++
    }
  }))
  const wall = (performance.now() - t0) / 1000
  for (let i = 0; i < 40 && !stats; i++) await new Promise((r) => setTimeout(r, 100))
  console.log(`${name.padEnd(11)} ${String(n).padStart(3)} members | ${(count / wall).toFixed(0).padStart(5)} /s | p50 ${pct(lat, 50).toFixed(0).padStart(5)} p95 ${pct(lat, 95).toFixed(0).padStart(5)} p99 ${pct(lat, 99).toFixed(0).padStart(5)} max ${Math.max(...lat).toFixed(0).padStart(5)} ms | errors ${errors} | cpu ${stats}`)
}

console.log(`# ${new Date().toISOString()} API ${API}, ${seconds} s per level, closed loop, load ${process.env.LOADAVG ?? ''}`)
if (process.argv.includes('--mix')) {
  for (const n of levels) await level('home-mix', n, async (token) => (await Promise.all(HOME().map((r) => call(token, r)))).every((o) => o.ok))
} else {
  for (const [name, make] of Object.entries(ENDPOINTS)) {
    if (only.length && !only.includes(name)) continue
    for (const n of levels) await level(name, n, async (token, i) => (await call(token, make(i))).ok)
  }
}
