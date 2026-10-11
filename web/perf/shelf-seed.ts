/**
 * Your shelf for everyone: the members its proof and its numbers need, on a throwaway local stack
 * (perf/env.ts; never anything but 127.0.0.1 / localhost).
 *
 *   shelf40@libellus.local     40 Books: 2 being read, 38 finished over three years, the contact sheet's twelve covers first
 *   shelf1000@libellus.local   1,000 Books: 3 being read, 997 finished over twelve years
 *   shelf0@libellus.local      nothing finished yet (two Books on Want to read)
 *
 *   PERF_STACK_PORT=55761 PERF_STACK_DIR=/tmp/shelf-everyone-stack pnpm perf:shelf-seed
 *
 * Their Books are Catalogue Books of their own (apple_id 66xxxxxxxx) with the proof covers
 * (perf/shelfCovers.ts, served by perf/serve.mjs) and the colours the app stores for a cover
 * (`coverColors`, a thumbhash), so the shelf's colour rule runs on what it runs on in production.
 * Idempotent: the members and their Books go first. Synthetic data only.
 */
import { createHash } from 'node:crypto'
import pg from 'pg'
import { rgbaToThumbHash } from 'thumbhash'
import { coverColors } from '../app/data/covers'
import { coverPixels, proofCoverUrl, proofCovers, type ProofCover } from './shelfCovers'
import { env } from './env'

export const SHELF_MEMBERS = {
  forty: { id: 'de000000-0000-4000-8000-0000000005f0', email: 'shelf40@libellus.local', books: 40 },
  thousand: { id: 'de000000-0000-4000-8000-0000000005f1', email: 'shelf1000@libellus.local', books: 1000 },
  empty: { id: 'de000000-0000-4000-8000-0000000005f2', email: 'shelf0@libellus.local', books: 0 },
} as const

if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(env.supabaseUrl)) throw new Error(`shelf-seed: refusing ${env.supabaseUrl}: not a local stack`)

const uuid = (key: string) => {
  const h = createHash('sha1').update(`shelf-everyone:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const FORMATS = ['hardcover', 'paperback', 'paperback', 'ebook', 'ebook', 'audiobook'] as const

type SeedBook = { id: string; cover: ProofCover; pages: number; format: string; isbn13: string; dominant: string; secondary: string; thumbhash: string; n: number }

async function booksFor(prefix: string, count: number, offset: number): Promise<SeedBook[]> {
  const covers = proofCovers(offset + count).slice(offset)
  const out: SeedBook[] = []
  for (const [i, cover] of covers.entries()) {
    const pixels = await coverPixels(cover)
    const colours = coverColors(pixels)
    const n = offset + i + 1
    out.push({
      id: uuid(`${prefix}:book:${i}`),
      cover,
      n,
      pages: 120 + ((n * 97) % 680),
      format: FORMATS[n % FORMATS.length]!,
      isbn13: isbn13(n),
      ...colours,
      thumbhash: Buffer.from(rgbaToThumbHash(pixels.width, pixels.height, pixels.data)).toString('base64'),
    })
  }
  return out
}

/** A valid ISBN-13 (its check digit right), so the back's barcode prints. */
function isbn13(n: number): string {
  const body = `978${String(660000000 + n).padStart(9, '0')}`
  const sum = [...body].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0)
  return body + ((10 - (sum % 10)) % 10)
}

const client = new pg.Client({ connectionString: env.dbUrl })
await client.connect()
const q = (text: string, values: unknown[] = []) => client.query(text, values)

const today = new Date()
const day = (back: number) => new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10)

await q('begin')
try {
  for (const member of Object.values(SHELF_MEMBERS)) await q('delete from auth.users where id = $1', [member.id])
  await q(`delete from public.books where apple_id ~ '^66[0-9]{8}$'`)

  for (const [key, member] of Object.entries(SHELF_MEMBERS)) {
    await q(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), '{"provider":"email","providers":["email"]}', '{"invite_code":"LIBELLUS-DEV"}', now(), now(), '', '', '', '')`,
      [member.id, member.email],
    )
    await q(
      `insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
       values (gen_random_uuid(), $1::uuid, $1::text, 'email', $2::jsonb, now(), now())`,
      [member.id, JSON.stringify({ sub: member.id, email: member.email, email_verified: true })],
    )

    // The empty member: two Books on Want to read, nothing finished.
    const count = member.books || 2
    const offset = key === 'thousand' ? 40 : key === 'empty' ? 1040 : 0
    const books = await booksFor(key, count, offset)
    for (let from = 0; from < books.length; from += 500) {
      const chunk = books.slice(from, from + 500)
      await q(
        `insert into public.books (id, title, authors, isbn13, page_count, published_year, language, publisher, cover_url, cover_thumbhash, cover_dominant, cover_secondary, source, apple_id, format)
         select id, title, array[author], isbn13, pages, 2015, 'en', 'Proof Press', cover_url, th, dom, sec, 'apple', '66' || lpad(n::text, 8, '0'), format::public.book_format
           from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[], $8::text[], $9::text[], $10::int[], $11::text[])
                as t(id, title, author, isbn13, pages, cover_url, th, dom, sec, n, format)`,
        [
          chunk.map((b) => b.id),
          chunk.map((b) => b.cover.title),
          chunk.map((b) => b.cover.author),
          chunk.map((b) => b.isbn13),
          chunk.map((b) => b.pages),
          chunk.map((b) => proofCoverUrl(b.n)),
          chunk.map((b) => b.thumbhash),
          chunk.map((b) => b.dominant),
          chunk.map((b) => b.secondary),
          chunk.map((b) => b.n),
          chunk.map((b) => b.format),
        ],
      )
    }
    // The blurb the back prints (an insert's description is the catalogue's to set: books_no_client_description).
    await q(
      `update public.books set description = title || ' is ' || authors[1] || '''s quiet novel about a town that keeps its secrets. ' ||
         'Over one long summer a stranger arrives, the harbour freezes early and three families learn what they owe each other. ' ||
         'Told in short chapters that move between the shore and the hills, it is a book about weather, memory and staying.'
        where id = any($1::uuid[])`,
      [books.map((b) => b.id)],
    )
    const entries = books.map((b, i) => ({ b, i, id: uuid(`${key}:entry:${i}`) }))
    await q(
      `insert into public.library_entries (id, member_id, book_id, added_at)
       select id, $1::uuid, book_id, now() - (d || ' days')::interval from unnest($2::uuid[], $3::uuid[], $4::int[]) as t(id, book_id, d)`,
      [member.id, entries.map((e) => e.id), entries.map((e) => e.b.id), entries.map((e) => 10 + e.i * 3)],
    )
    if (!member.books) continue
    // Finished over three years (40) or twelve (1,000), the newest a few days ago; the first few being read.
    const span = key === 'thousand' ? 12 * 365 : 3 * 365
    const reading = key === 'thousand' ? 3 : 2
    for (const e of entries) {
      if (e.i < reading) {
        await q(`insert into public.reading_sessions (id, entry_id, started_on) values ($1, $2, $3)`, [uuid(`${key}:session:${e.i}`), e.id, day(2 + e.i * 4)])
        continue
      }
      const ended = 3 + Math.round(((e.i - reading) / Math.max(1, entries.length - reading)) * span)
      await q(
        `insert into public.reading_sessions (id, entry_id, started_on, ended_on, outcome, rating) values ($1, $2, $3, $4, 'finished', $5::smallint)`,
        [uuid(`${key}:session:${e.i}`), e.id, day(ended + 6 + (e.i % 20)), day(ended), 8 + (e.i % 13)],
      )
    }
  }
  await q('commit')
} catch (error) {
  await q('rollback')
  throw error
} finally {
  await client.end()
}
console.log('shelf-seed: done', Object.fromEntries(Object.entries(SHELF_MEMBERS).map(([k, m]) => [k, m.email])))
