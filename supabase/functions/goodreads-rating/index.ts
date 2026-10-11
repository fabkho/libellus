/**
 * The `goodreads-rating` edge function (issue #69): handler.ts with the real
 * cache (`goodreads_ratings`, written with the service role), the real
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
import type { GoodreadsAnswer } from './goodreads.ts'
import { type CacheKey, type CachedAnswer, type Caller, createHandler, MEMBER_LIMIT, MEMBER_WINDOW_SECONDS } from './handler.ts'
import { sameSecret } from './secret.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('goodreads-rating needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

type Row = {
  isbn13?: string
  title_key?: string
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

/** Where an answer is cached: by ISBN-13, or by title and authors for a Book without an ISBN. */
function table(key: CacheKey) {
  return 'isbn13' in key
    ? { name: 'goodreads_ratings', column: 'isbn13', value: key.isbn13 }
    : { name: 'goodreads_title_ratings', column: 'title_key', value: key.titleKey }
}

function toRow(key: CacheKey, answer: GoodreadsAnswer & { checkedAt: string }): Row {
  const found = answer.status === 'found' ? answer : null
  return {
    [table(key).column]: table(key).value,
    status: answer.status,
    matched_by: found?.matchedBy ?? null,
    goodreads_id: found?.goodreadsId ?? null,
    rating: found?.rating ?? null,
    ratings_count: found?.ratingsCount ?? null,
    reviews_count: found?.reviewsCount ?? null,
    checked_at: answer.checkedAt,
  }
}

const handler = createHandler({
  cache: {
    async get(key) {
      const { name, column, value } = table(key)
      const { data, error } = await supabase.from(name).select('*').eq(column, value).maybeSingle<Row>()
      if (error) throw new Error(error.message)
      return data ? fromRow(data) : null
    },
    async put(key, answer) {
      const { error } = await supabase.from(table(key).name).upsert(toRow(key, answer))
      if (error) throw new Error(error.message)
    },
  },
  goodreads: createGoodreads({ fetch: (input, init) => fetch(input, init), userAgent: userAgent(Deno.env.get('LIBELLUS_SITE_URL')) }),
  async authorize(request): Promise<Caller | null> {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!token) return null
    if (await sameSecret(token, serviceKey)) return { member: null }
    const { data, error } = await supabase.auth.getUser(token)
    return !error && data.user ? { member: data.user.id } : null
  },
  async throttle(member) {
    const { data, error } = await supabase.rpc('edge_rate_hit', {
      p_member: member,
      p_bucket: 'goodreads-rating',
      p_limit: MEMBER_LIMIT,
      p_window_seconds: MEMBER_WINDOW_SECONDS,
    })
    if (error) throw new Error(error.message)
    return data === true
  },
})

Deno.serve(handler)
