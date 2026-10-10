// NOW variant of scripts/perf/screens.mjs: the requests of v1.9.1 (lists without `description` (#255), ordered by
// added_at, id and ranged like data/paging.ts (#260), Home's two series calls as one `started_and_muted_series`
// (#255)). The original stays for the before column. Run from the repo root.
// What each screen asks the API, replayed against a local throwaway stack through PostgREST, as
// seeded member(s) (scripts/perf/seed.sql). Measures wall time per request and bytes (uncompressed
// and as gzip), alone (--members 1 --rounds N) or as N members opening Home at once.
//
//   node scripts/perf/screens.mjs --screen home --members 20 --rounds 5
//   node scripts/perf/screens.mjs --screen all --rounds 20
//
// Env: API (default http://127.0.0.1:55661), ANON_KEY (the stack's publishable key).
import { gzipSync } from 'node:zlib'
import { memberJwt } from '../../../../scripts/perf/jwt.mjs'

const API = process.env.API ?? 'http://127.0.0.1:55661'
const ANON = process.env.ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []))
const SCREEN = args.screen ?? 'home'
const MEMBERS = Number(args.members ?? 1)
const ROUNDS = Number(args.rounds ?? 10)
const MEMBER_BASE = Number(args.base ?? 1)

const BOOK = '*,goodreads:goodreads_rating(*)'
const LIST_BOOK = 'id,title,authors,isbn13,isbn10,page_count,published_year,language,publisher,cover_url,cover_thumbhash,cover_dominant,cover_secondary,source,apple_id,openlibrary_edition_key,openlibrary_work_key,created_at,format,goodreads:goodreads_rating(*)'
const ENTRY = `id,status,added_at,page_count_override,format_override,read_as,hidden,book:books!inner(${LIST_BOOK}),latest:latest_session(*)`
const SESSION = `id,entry_id,started_on,ended_on,outcome,rating,created_at,entry:library_entries!inner(page_count_override,book:books!inner(${LIST_BOOK}))`
const year = new Date().getFullYear()
const today = new Date().toISOString().slice(0, 10)
const from = new Date(Date.now() - 83 * 864e5).toISOString().slice(0, 10)

const q = (o) => new URLSearchParams(o).toString()
const get = (path, headers = {}) => ({ method: 'GET', path, headers })
const rpc = (name, body) => ({ method: 'POST', path: `/rest/v1/rpc/${name}`, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

async function call(token, r) {
  const t0 = performance.now()
  const res = await fetch(API + r.path, {
    method: r.method, body: r.body,
    headers: { apikey: ANON, authorization: `Bearer ${token}`, ...r.headers },
  })
  const buf = Buffer.from(await res.arrayBuffer())
  return { ms: performance.now() - t0, status: res.status, bytes: buf.length, gz: gzipSync(buf).length, body: buf }
}

const RANGE = { range: '0-999', 'range-unit': 'items' }
const lists = () => [
  get(`/rest/v1/library_entries?${q({ select: ENTRY, status: 'eq.want_to_read', order: 'added_at.desc,id' })}`, RANGE),
  get(`/rest/v1/library_entries?${q({ select: ENTRY, status: 'eq.reading', order: 'latest(started_on).desc.nullslast,added_at.desc,id' })}`, RANGE),
  get(`/rest/v1/library_entries?${q({ select: ENTRY, status: 'eq.finished', order: 'latest(ended_on).desc.nullslast,added_at.desc,id' })}`, RANGE),
]
const readInYear = () =>
  get(`/rest/v1/reading_sessions?${new URLSearchParams([['select', 'id'], ['outcome', 'eq.finished'], ['ended_on', `gte.${year}-01-01`], ['ended_on', `lte.${year}-12-31`]])}`, { prefer: 'count=exact', range: '0-0' })

// name -> (ctx) => [requests]; ctx holds an entry/book/series/author of this member, found first.
const SCREENS = {
  home: () => [...lists(), readInYear(), rpc('started_and_muted_series', { p_limit: 50, p_language: 'en' })],
  library: () => [...lists(), rpc('library_genres', {})],
  profile: () => [
    get(`/rest/v1/reading_sessions?${q({ select: SESSION, 'outcome': 'not.is.null', order: 'id' })}`, { range: '0-999', 'range-unit': 'items' }),
    get(`/rest/v1/library_entries?${q({ select: 'id', status: 'eq.want_to_read' })}`, { prefer: 'count=exact', range: '0-0' }),
    get(`/rest/v1/library_entries?${q({ select: 'id', status: 'eq.reading' })}`, { prefer: 'count=exact', range: '0-0' }),
    get(`/rest/v1/reading_progress_days?${new URLSearchParams([['select', `day,start_page,start_percent,end_page,end_percent,session:reading_sessions!inner(${SESSION})`], ['day', `gte.${from}`], ['day', `lte.${today}`], ['order', 'session_id'], ['order', 'day']])}`, { range: '0-999' }),
    get(`/rest/v1/reading_progress_days?${q({ select: 'day', order: 'day', limit: 1 })}`),
  ],
  book: (c) => [
    get(`/rest/v1/books?${q({ select: BOOK, id: `eq.${c.bookId}` })}`, { accept: 'application/vnd.pgrst.object+json' }),
    get(`/rest/v1/library_entries?${q({ select: ENTRY, book_id: `eq.${c.bookId}` })}`, { accept: 'application/vnd.pgrst.object+json' }),
    rpc('book_series_info', { p_book: c.bookId, p_language: 'en' }),
    rpc('book_authors_of', { p_book: c.bookId }),
    rpc('book_genres', { p_book: c.bookId }),
    get(`/rest/v1/reading_sessions?${q({ select: '*', entry_id: `eq.${c.entryId}` })}`),
  ],
  author: (c) => [rpc('author_page', { p_author: c.authorKey, p_language: 'en' })],
  series: (c) => [rpc('series_works', { p_series: c.seriesId, p_language: 'en' })],
  search: () => [rpc('search_books', { p_query: 'book title 1', p_limit: 20 }), rpc('search_books', { p_query: 'author 7 lastname', p_limit: 20 }), rpc('search_books', { p_query: 'bo', p_limit: 20 })],
  // Social v1 (feat/social-v1, applied by hand to the throwaway stack): Home as it will be, and the friends screen.
  homeSocial: () => [...lists(), readInYear(), rpc('started_series', { p_limit: 50, p_language: 'en' }), rpc('muted_series_list', { p_limit: 50, p_language: 'en' }), rpc('feed', { p_before: null, p_before_id: null, p_limit: 30 }), rpc('my_people', {})],
  friends: () => [rpc('feed', { p_before: null, p_before_id: null, p_limit: 30 }), rpc('my_people', {})],
  next: () => [rpc('next_in_series', { p_limit: 5, p_language: 'en' }), rpc('my_works', {})],
}
SCREENS.all = null

async function context(token) {
  const entries = JSON.parse((await call(token, get(`/rest/v1/library_entries?${q({ select: 'id,book_id', status: 'eq.finished', limit: 60 })}`))).body)
  // A book that is in a series, if the member has one: the book page and the series sheet then do real work.
  let pick = entries[0]
  let seriesId
  for (const e of entries) {
    const info = JSON.parse((await call(token, rpc('book_series_info', { p_book: e.book_id, p_language: 'en' }))).body)
    const id = info?.series?.[0]?.id ?? info?.series?.[0]?.series?.id
    if (id) { pick = e; seriesId = id; break }
  }
  const a = pick ? JSON.parse((await call(token, rpc('book_authors_of', { p_book: pick.book_id }))).body) : []
  if (!seriesId) seriesId = JSON.parse((await call(token, get(`/rest/v1/series?${q({ select: 'id', limit: 1 })}`))).body)[0]?.id
  return { entryId: pick?.id, bookId: pick?.book_id, authorKey: a?.[0]?.author_key, seriesId }
}

const pct = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : NaN
const fmt = (n) => (Number.isNaN(n) ? '-' : n.toFixed(1))

async function runScreen(name, tokens, ctxs) {
  // Every member opens the screen at the same moment, its requests in parallel (as the app does), ROUNDS times.
  const per = new Map() // request label -> [ms]
  const screenMs = []
  const bytes = new Map()
  for (let round = 0; round < ROUNDS + 1; round++) {
    const warm = round === 0
    await Promise.all(tokens.map(async (token, i) => {
      const reqs = SCREENS[name](ctxs[i])
      const t0 = performance.now()
      const out = await Promise.all(reqs.map((r) => call(token, r)))
      const total = performance.now() - t0
      if (warm) return
      screenMs.push(total)
      out.forEach((o, k) => {
        const label = `${k + 1}. ${reqs[k].method} ${reqs[k].path.replace('/rest/v1/', '').split('?')[0]}${reqs[k].path.includes('status=eq.') ? '?' + reqs[k].path.match(/status=eq\.(\w+)/)[1] : ''}`
        if (!per.has(label)) per.set(label, [])
        per.get(label).push(o.ms)
        bytes.set(label, [o.bytes, o.gz, o.status])
      })
    }))
  }
  console.log(`\n## ${name}: ${MEMBERS} member(s) x ${ROUNDS} rounds (screen = slowest request of the parallel set)`)
  console.log('request | status | p50 ms | p95 ms | raw KB | gzip KB')
  for (const [label, ms] of per) {
    const [raw, gz, status] = bytes.get(label)
    console.log(`${label} | ${status} | ${fmt(pct(ms, 50))} | ${fmt(pct(ms, 95))} | ${(raw / 1024).toFixed(1)} | ${(gz / 1024).toFixed(1)}`)
  }
  console.log(`screen total | | ${fmt(pct(screenMs, 50))} | ${fmt(pct(screenMs, 95))} | |`)
}

const tokens = Array.from({ length: MEMBERS }, (_, i) => memberJwt(MEMBER_BASE + i))
const ctxs = await Promise.all(tokens.map(context))
const names = SCREEN === 'all' ? Object.keys(SCREENS).filter((k) => SCREENS[k] && !['homeSocial', 'friends'].includes(k)) : SCREEN.split(',')
for (const n of names) await runScreen(n, tokens, ctxs)
