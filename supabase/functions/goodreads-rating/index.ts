/**
 * The `goodreads-rating` edge function (issue #69): handler.ts with the real
 * caches (`goodreads_ratings` and, for the import's editions, issue #111,
 * `goodreads_editions` — both written with the service role), the real
 * Goodreads (client.ts: identified, one request a second, three seconds each)
 * and the member check. README.md says how to run and deploy it.
 *
 * `verify_jwt` is off (supabase/config.toml): the function checks the caller
 * itself, so it works with either kind of API key. A signed-in member's
 * access token passes, and so does the service-role key (the cache warm-up
 * script, warm_library.ts); the anon key does not.
 */
import { createClient } from '@supabase/supabase-js'
import { createGoodreads, userAgent } from './client.ts'
import type { EditionAnswer } from './edition.ts'
import type { GoodreadsAnswer } from './goodreads.ts'
import { type CachedAnswer, type CachedEdition, createHandler } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('goodreads-rating needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

type Row = {
  isbn13: string
  status: 'found' | 'not_found'
  matched_by: 'isbn' | 'title' | null
  goodreads_id: string | null
  rating: number | string | null
  ratings_count: number | null
  reviews_count: number | null
  checked_at: string
}

function fromRow(row: Row): CachedAnswer {
  if (row.status !== 'found') return { status: 'not_found', checkedAt: row.checked_at }
  return {
    status: 'found',
    matchedBy: row.matched_by ?? 'isbn',
    goodreadsId: row.goodreads_id!,
    rating: Number(row.rating),
    ratingsCount: row.ratings_count!,
    reviewsCount: row.reviews_count,
    checkedAt: row.checked_at,
  }
}

function toRow(isbn13: string, answer: GoodreadsAnswer & { checkedAt: string }): Row {
  const found = answer.status === 'found' ? answer : null
  return {
    isbn13,
    status: answer.status,
    matched_by: found?.matchedBy ?? null,
    goodreads_id: found?.goodreadsId ?? null,
    rating: found?.rating ?? null,
    ratings_count: found?.ratingsCount ?? null,
    reviews_count: found?.reviewsCount ?? null,
    checked_at: answer.checkedAt,
  }
}

type EditionRow = {
  goodreads_id: string
  status: 'found' | 'not_found'
  title: string | null
  isbn13: string | null
  isbn10: string | null
  asin: string | null
  language: string | null
  page_count: number | null
  format: string | null
  publisher: string | null
  published_year: number | null
  checked_at: string
}

function fromEditionRow(row: EditionRow): CachedEdition {
  if (row.status !== 'found') return { status: 'not_found', checkedAt: row.checked_at }
  return {
    status: 'found',
    goodreadsId: row.goodreads_id,
    title: row.title,
    isbn13: row.isbn13,
    isbn10: row.isbn10,
    asin: row.asin,
    language: row.language,
    pageCount: row.page_count,
    format: row.format,
    publisher: row.publisher,
    year: row.published_year,
    checkedAt: row.checked_at,
  }
}

function toEditionRow(goodreadsId: string, edition: EditionAnswer & { checkedAt: string }): EditionRow {
  const found = edition.status === 'found' ? edition : null
  return {
    goodreads_id: goodreadsId,
    status: edition.status,
    title: found?.title ?? null,
    isbn13: found?.isbn13 ?? null,
    isbn10: found?.isbn10 ?? null,
    asin: found?.asin ?? null,
    language: found?.language ?? null,
    page_count: found?.pageCount ?? null,
    format: found?.format ?? null,
    publisher: found?.publisher ?? null,
    published_year: found?.year ?? null,
    checked_at: edition.checkedAt,
  }
}

const handler = createHandler({
  cache: {
    async get(isbn13) {
      const { data, error } = await supabase.from('goodreads_ratings').select('*').eq('isbn13', isbn13).maybeSingle<Row>()
      if (error) throw new Error(error.message)
      return data ? fromRow(data) : null
    },
    async put(isbn13, answer) {
      const { error } = await supabase.from('goodreads_ratings').upsert(toRow(isbn13, answer))
      if (error) throw new Error(error.message)
    },
  },
  editions: {
    async get(goodreadsId) {
      const { data, error } = await supabase
        .from('goodreads_editions')
        .select('*')
        .eq('goodreads_id', goodreadsId)
        .maybeSingle<EditionRow>()
      if (error) throw new Error(error.message)
      return data ? fromEditionRow(data) : null
    },
    async put(goodreadsId, edition) {
      const { error } = await supabase.from('goodreads_editions').upsert(toEditionRow(goodreadsId, edition))
      if (error) throw new Error(error.message)
    },
  },
  goodreads: createGoodreads({ fetch: (input, init) => fetch(input, init), userAgent: userAgent(Deno.env.get('LIBELLUS_SITE_URL')) }),
  async authorize(request) {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!token) return false
    if (token === serviceKey) return true
    const { data, error } = await supabase.auth.getUser(token)
    return !error && Boolean(data.user)
  },
})

Deno.serve(handler)
