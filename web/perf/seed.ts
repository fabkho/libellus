/**
 * Perf harness: seeds a local stack with a production-sized library, synthetic but shaped like the
 * owner's: ~150 Library entries (finished with ratings and reviews, a few being read, the rest
 * Want to read, series, collections, progress days), ~2,300 Catalogue Books and Works, authors,
 * genres. Only text lives in the database (cover pictures come from perf/serve.mjs), so nothing
 * here is real reading history.
 *
 *   pnpm perf:seed                       # the stack named in PERF_* (perf/env.ts)
 *
 * Idempotent: it removes the member it makes (perf@libellus.local) and everything of hers first,
 * then the Catalogue rows it made (apple_id 77xxxxxxxx). Never run it against anything but a
 * throwaway local stack: it refuses a URL that is not 127.0.0.1 / localhost.
 */
import { createHash } from 'node:crypto'
import pg from 'pg'
import sharp from 'sharp'
import { rgbaToThumbHash } from 'thumbhash'
import { env, MEMBER_EMAIL, MEMBER_ID } from './env'

const ENTRIES = Number(process.env.PERF_ENTRIES ?? 150)
const CATALOGUE = Number(process.env.PERF_CATALOGUE ?? 2300)

if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.supabaseUrl)) throw new Error(`seed: refusing ${env.supabaseUrl}: not a local stack`)

// A deterministic generator: two runs make the same library.
let state = 0x9e3779b9
const rand = () => {
  state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x6d2b79f5) >>> 0
  return state / 4294967296
}
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1))

const WORDS =
  'the of and a to in is was he for it with as his on be at by had not are but from or have an they which one you were her all she there would their we him been has when who will more no if out so said what up its about into than them can only other new some could time these two may then do first any my now such like our over man me even most made after also did many before must through back years where much your way well down should because each just those people how too little state good very make world still own see men work long get here between both life being under never day same another know while last might us great old year off come since against go came right used take three'.split(
    ' ',
  )
const sentence = () => {
  const n = between(8, 22)
  const s = Array.from({ length: n }, () => pick(WORDS)).join(' ')
  return s[0]!.toUpperCase() + s.slice(1) + '.'
}
const paragraph = (chars: number) => {
  let s = ''
  while (s.length < chars) s += `${sentence()} `
  return s.trim()
}
const NAMES_A = 'Anna Ben Clara David Elena Felix Greta Hugo Iris Jonas Klara Lukas Mira Noah Olga Paul Quinn Rosa Sven Tara Uwe Vera Willa Xaver Yara Zoe'.split(' ')
const NAMES_B = 'Adler Brandt Czerny Dietrich Engel Fischer Graf Hartmann Iversen Jung Keller Lang Maier Neumann Ostrowski Pohl Quast Richter Schulz Thalberg Ulrich Vogel Winter Zimmer'.split(' ')
const TITLE_A = 'Last First Silent Hidden Broken Golden Winter Summer Midnight Paper Iron Glass Hollow Distant Burning Quiet Lost Second Third Open Wild'.split(' ')
const TITLE_B = 'Garden River House Letters Empire Season Machine Atlas Winter Island Orchard Archive Harbour Signal Mirror Voyage Kingdom Library Border Chorus'.split(' ')
const GENRES = ['sci-fi', 'fantasy', 'horror', 'crime', 'thriller', 'romance', 'literary', 'historical', 'classics', 'ya', 'graphic', 'poetry', 'nonfiction', 'biography', 'history', 'science', 'philosophy']
const FORMATS = ['hardcover', 'paperback', 'ebook', 'audiobook'] as const
const LANGS = ['en', 'en', 'en', 'de']

// 24 thumbhashes of small gradients in different hues: what a cover's blur placeholder costs.
function thumbs(): { hash: string; dominant: string; secondary: string }[] {
  const out: { hash: string; dominant: string; secondary: string }[] = []
  for (let i = 0; i < 24; i++) {
    const h = (i / 24) * 360
    const rgb = (hue: number, l: number) => {
      const a = 0.5 * Math.min(l, 1 - l)
      const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(((n + hue / 30) % 12) - 3, 9 - ((n + hue / 30) % 12), 1))))
      return [f(0), f(8), f(4)] as const
    }
    const w = 32
    const hgt = 48
    const data = new Uint8Array(w * hgt * 4)
    const c1 = rgb(h, 0.35)
    const c2 = rgb((h + 40) % 360, 0.6)
    for (let y = 0; y < hgt; y++)
      for (let x = 0; x < w; x++) {
        const t = y / hgt
        const o = (y * w + x) * 4
        data[o] = c1[0] * (1 - t) + c2[0] * t
        data[o + 1] = c1[1] * (1 - t) + c2[1] * t
        data[o + 2] = c1[2] * (1 - t) + c2[2] * t
        data[o + 3] = 255
      }
    const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
    out.push({ hash: Buffer.from(rgbaToThumbHash(w, hgt, data)).toString('base64'), dominant: hex(c1), secondary: hex(c2) })
  }
  return out
}
void sharp // sharp is only needed by perf/covers.ts; imported here so a missing native build fails early.
const TH = thumbs()

type Book = { id: string; title: string; authors: string[]; isbn13: string; pages: number; year: number; lang: string; publisher: string; description: string; format: string; n: number }
const uuid = (key: string) => {
  const h = createHash('sha1').update(`libellus-perf:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const isbn13 = (n: number) => {
  const body = `978${String(1000000000 + n * 7919).slice(0, 9)}`
  const sum = [...body].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0)
  return body + ((10 - (sum % 10)) % 10)
}

const authorPool = Array.from({ length: 640 }, (_, i) => `${NAMES_A[i % NAMES_A.length]} ${NAMES_B[Math.floor(i / NAMES_A.length) % NAMES_B.length]}${i >= 624 ? ` ${i}` : ''}`)
const authorIds = authorPool.map((name) => uuid(`author:${name}`))

const books: Book[] = Array.from({ length: CATALOGUE }, (_, n) => {
  const nAuthors = rand() < 0.88 ? 1 : 2
  const authors = Array.from({ length: nAuthors }, () => pick(authorPool))
  return {
    n,
    id: uuid(`book:${n}`),
    title: `The ${pick(TITLE_A)} ${pick(TITLE_B)}${rand() < 0.4 ? `: ${pick(TITLE_A)} ${pick(TITLE_B)} ${n}` : ` ${n}`}`,
    authors: [...new Set(authors)],
    isbn13: isbn13(n),
    pages: between(120, 900),
    year: between(1950, 2026),
    lang: pick(LANGS),
    publisher: `${pick(NAMES_B)} & ${pick(NAMES_B)} Verlag`,
    description: paragraph(between(500, 1700)),
    format: pick(FORMATS),
    n,
  }
})

const client = new pg.Client({ connectionString: env.dbUrl })
await client.connect()
const q = (text: string, values: unknown[] = []) => client.query(text, values)

console.log(`seed: ${env.dbUrl} — ${ENTRIES} entries, ${CATALOGUE} Catalogue Books`)
await q('begin')
try {
  // Fresh: the member and her data (cascade), then our Catalogue rows.
  await q('delete from auth.users where id = $1', [MEMBER_ID])
  await q(`delete from public.works where openlibrary_key ~ '^OL9[0-9]{7}W$'`)
  await q(`delete from public.books where apple_id ~ '^77[0-9]{8}$'`)
  await q(`delete from public.authors where openlibrary_key ~ '^OL9[0-9]{6}A$'`)
  await q(`delete from public.series where name like 'Perf series %'`)

  await q(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
     values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), '{"provider":"email","providers":["email"]}', '{"invite_code":"LIBELLUS-DEV"}', now(), now(), '', '', '', '')`,
    [MEMBER_ID, MEMBER_EMAIL],
  )
  await q(
    `insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
     values (gen_random_uuid(), $1::uuid, $1::text, 'email', $2::jsonb, now(), now())`,
    [MEMBER_ID, JSON.stringify({ sub: MEMBER_ID, email: MEMBER_EMAIL, email_verified: true })],
  )

  // Authors (the Catalogue's people) and Books, in chunks.
  await q(
    `insert into public.authors (id, name, openlibrary_key, summaries)
     select id, name, 'OL' || (9000000 + n) || 'A', '{}'::jsonb from unnest($1::uuid[], $2::text[], $3::int[]) as t(id, name, n)`,
    [authorIds, authorPool, authorPool.map((_, i) => i)],
  )
  for (let from = 0; from < books.length; from += 500) {
    const chunk = books.slice(from, from + 500)
    await q(
      `insert into public.books (id, title, authors, isbn13, page_count, published_year, language, publisher, description, cover_url, cover_thumbhash, cover_dominant, cover_secondary, source, apple_id, format)
       select id, title, string_to_array(authors, '|'), isbn13, pages, year, lang, publisher, description,
              'https://is1-ssl.mzstatic.com/image/thumb/Publication/perf/' || n || '/' || isbn13 || '.jpg/600x900bb.jpg', th, dom, sec, 'apple', '77' || lpad(n::text, 8, '0'), format::public.book_format
         from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::int[])
              as t(id, title, authors, isbn13, pages, year, lang, publisher, description, format, th, dom, sec, n)`,
      [
        chunk.map((b) => b.id),
        chunk.map((b) => b.title),
        chunk.map((b) => b.authors.join('|')),
        chunk.map((b) => b.isbn13),
        chunk.map((b) => b.pages),
        chunk.map((b) => b.year),
        chunk.map((b) => b.lang),
        chunk.map((b) => b.publisher),
        chunk.map((b) => b.description),
        chunk.map((b) => b.format),
        chunk.map((b) => TH[b.n % TH.length]!.hash),
        chunk.map((b) => TH[b.n % TH.length]!.dominant),
        chunk.map((b) => TH[b.n % TH.length]!.secondary),
        chunk.map((b) => b.n),
      ],
    )
    await q(
      `insert into public.book_authors (book_id, position, author_id)
       select b.id, a.ord::smallint, au.id
         from public.books b
         cross join lateral unnest(b.authors) with ordinality as a(name, ord)
         join public.authors au on au.name = a.name and au.openlibrary_key ~ '^OL9[0-9]{6}A$'
        where b.id = any($1::uuid[]) on conflict do nothing`,
      [chunk.map((b) => b.id)],
    )
  }

  // Works: the Catalogue's works, one per Book here (the author pages read them).
  await q(
    `insert into public.works (id, title, openlibrary_key, titles, first_year, kind, editions, genre_ids)
     select gen_random_uuid(), title, 'OL' || (90000000 + n) || 'W', '{}'::jsonb, published_year, 'novel', '{}'::jsonb, '{}' from (select title, published_year, substr(apple_id, 3)::int as n from public.books where apple_id ~ '^77[0-9]{8}$') b`,
  )
  await q(
    `insert into public.book_works (book_id, work_id, matched_by)
     select b.id, w.id, 'isbn' from public.books b join public.works w on w.openlibrary_key = 'OL' || (90000000 + substr(b.apple_id, 3)::int) || 'W' where b.apple_id ~ '^77[0-9]{8}$'`,
  )
  await q(
    `insert into public.work_authors (work_id, author_id, position)
     select bw.work_id, ba.author_id, ba.position from public.book_works bw join public.book_authors ba on ba.book_id = bw.book_id where bw.book_id in (select id from public.books where apple_id ~ '^77[0-9]{8}$') on conflict do nothing`,
  )

  // The Library: the first ENTRIES Books, spread over three years. Status follows from the sessions (trigger).
  const today = new Date()
  const day = (back: number) => new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10)
  const entries = books.slice(0, ENTRIES).map((b, i) => {
    const kind = i < 3 ? 'reading' : i < Math.round(ENTRIES * 0.68) ? 'finished' : 'want'
    return { b, i, kind, id: uuid(`entry:${i}`) }
  })
  await q(
    `insert into public.library_entries (id, member_id, book_id, added_at)
     select id, $1::uuid, book_id, now() - (d || ' days')::interval from unnest($2::uuid[], $3::uuid[], $4::int[]) as t(id, book_id, d)`,
    [MEMBER_ID, entries.map((e) => e.id), entries.map((e) => e.b.id), entries.map((e) => 20 + e.i * 7)],
  )
  const sessions: { id: string; entry: string; started: string; ended: string | null; outcome: string | null; rating: number | null; review: string | null; page: number | null; pct: number | null }[] = []
  for (const e of entries) {
    if (e.kind === 'want') continue
    if (e.kind === 'reading') {
      sessions.push({ id: uuid(`session:${e.i}`), entry: e.id, started: day(3 + e.i * 5), ended: null, outcome: null, rating: null, review: null, page: e.i === 0 ? null : Math.round(e.b.pages * 0.4), pct: e.i === 0 ? 37 : null })
      continue
    }
    // Finished: the first Book finishes ~1000 days ago, the last a few days ago.
    const ended = 3 + Math.round(((ENTRIES - e.i) / ENTRIES) * 1050)
    const days = between(4, 30)
    const abandoned = rand() < 0.06
    sessions.push({
      id: uuid(`session:${e.i}`),
      entry: e.id,
      started: day(ended + days),
      ended: day(ended),
      outcome: abandoned ? 'abandoned' : 'finished',
      rating: !abandoned && rand() < 0.85 ? between(8, 20) : null,
      review: !abandoned && rand() < 0.4 ? paragraph(between(150, 900)) : null,
      page: null,
      pct: null,
    })
    // A fifth were read twice.
    if (!abandoned && rand() < 0.2)
      sessions.push({ id: uuid(`session2:${e.i}`), entry: e.id, started: day(ended + days + 400), ended: day(ended + days + 380), outcome: 'finished', rating: between(8, 20), review: null, page: null, pct: null })
  }
  // Older sessions first so the trigger's "latest" is the right one.
  sessions.sort((a, b) => (a.started < b.started ? -1 : 1))
  for (const s of sessions) {
    await q(
      `insert into public.reading_sessions (id, entry_id, started_on, ended_on, outcome, rating, review, abandon_reason, progress_page, progress_percent, progress_updated_at)
       values ($1, $2, $3, $4, $5::public.session_outcome, $6::smallint, $7, $8, $9::int, $10::smallint, case when $9::int is not null or $10::smallint is not null then now() end)`,
      [s.id, s.entry, s.started, s.ended, s.outcome, s.rating, s.review, s.outcome === 'abandoned' ? 'Lost interest.' : null, s.page, s.pct],
    )
  }
  // Progress days: a row for every day of the reading sessions (the Profile's year view and streaks read them).
  await q(
    `insert into public.reading_progress_days (session_id, day, end_page)
     select s.id, d::date, least(coalesce(be.page_count, 300), 20 + (extract(epoch from (d - s.started_on::timestamp)) / 86400 * 18)::int)
       from public.reading_sessions s
       join public.library_entries le on le.id = s.entry_id
       join public.books be on be.id = le.book_id
       cross join lateral generate_series(s.started_on, coalesce(s.ended_on, current_date), interval '1 day') d
      where le.member_id = $1 and s.outcome is distinct from 'abandoned' on conflict do nothing`,
    [MEMBER_ID],
  )

  // Genres per Book (the Library's genre chips), series, collections.
  await q(
    `insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version)
     select le.book_id, g.id, 1, 'apple', 1, 1 from public.library_entries le
       join lateral (select (array[${GENRES.map((g) => `'${g}'`).join(',')}])[1 + (abs(hashtext(le.book_id::text)) % ${GENRES.length})] as id) g on true
      where le.member_id = $1 on conflict do nothing`,
    [MEMBER_ID],
  )
  for (let s = 0; s < 12; s++) {
    const series = uuid(`series:${s}`)
    await q(`insert into public.series (id, name, source, created_by) values ($1, $2, 'member', $3)`, [series, `Perf series ${s}`, MEMBER_ID])
    for (let p = 0; p < 4; p++) {
      const e = entries[s * 4 + p]
      if (e) await q(`insert into public.entry_series (entry_id, member_id, series_id, position) values ($1, $2, $3, $4) on conflict do nothing`, [e.id, MEMBER_ID, series, p + 1])
    }
  }
  for (let c = 0; c < 4; c++) {
    const id = uuid(`collection:${c}`)
    await q(`insert into public.collections (id, member_id, name, position) values ($1, $2, $3, $4)`, [id, MEMBER_ID, ['Summer', 'Classics', 'To lend', 'Favourites'][c], c])
    for (let p = 0; p < 10; p++) await q(`insert into public.collection_entries (collection_id, entry_id, position) values ($1, $2, $3)`, [id, entries[c * 10 + p]!.id, p])
  }
  await q('commit')
} catch (e) {
  await q('rollback')
  throw e
}
const counts = await q(
  `select (select count(*) from public.books where apple_id ~ '^77[0-9]{8}$') books,
          (select count(*) from public.library_entries where member_id = $1) entries,
          (select count(*) from public.reading_sessions s join public.library_entries le on le.id = s.entry_id where le.member_id = $1) sessions,
          (select count(*) from public.reading_progress_days d join public.reading_sessions s on s.id = d.session_id join public.library_entries le on le.id = s.entry_id where le.member_id = $1) days,
          (select count(*) from public.works where openlibrary_key ~ '^OL9[0-9]{7}W$') works`,
  [MEMBER_ID],
)
console.log('seed: done', counts.rows[0])
await client.end()
