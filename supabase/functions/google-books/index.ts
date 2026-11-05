/**
 * The `google-books` edge function (issue #305): handler.ts with the real cache (`google_books_cache`, written with the
 * service role), the daily budget (`google_books_budget_take`), the real Google Books (client.ts: the key in a header,
 * four seconds each) and the caller check. README.md says how to run, deploy and set the key.
 *
 * `verify_jwt` is off (supabase/config.toml): the function checks the caller itself, so it works with either kind of
 * API key. A signed-in member's access token passes, and so does the service-role key (the import job, `enrich`); the
 * anon key does not.
 *
 * The API key is the function secret `GOOGLE_BOOKS_API_KEY`, read from the environment on every request, never from
 * the repository. Without it the function answers `unavailable` (`not_configured`) and asks Google nothing.
 */
import { createClient } from '@supabase/supabase-js'
import type { GoogleVolume } from '../../../web/app/data/googleBooksRecord.ts'
import { createCallerCheck } from '../_shared/caller.ts'
import { createGoogleBooksClient } from './client.ts'
import { type BookRow, type Budget, createHandler, DEFAULT_FALLBACK_TTL_SECONDS, MEMBER_WINDOW_SECONDS } from './handler.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('google-books needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

type CacheRow = { status: 'found' | 'not_found'; volumes: GoogleVolume[]; expires_at: string }

async function catalogueBook(isbn13: string): Promise<BookRow | null> {
  const { data, error } = await supabase.from('books').select('*').is('owner_id', null).eq('isbn13', isbn13).maybeSingle<BookRow>()
  if (error) throw new Error(error.message)
  return data
}

function fallbackSeconds(): number {
  const set = Number(Deno.env.get('GOOGLE_BOOKS_CACHE_FALLBACK_SECONDS'))
  return Deno.env.get('GOOGLE_BOOKS_CACHE_FALLBACK_SECONDS') && Number.isFinite(set) && set >= 0 ? set : DEFAULT_FALLBACK_TTL_SECONDS
}

const handler = createHandler({
  google: createGoogleBooksClient({
    fetch: (address, init) => fetch(address, init),
    apiKey: () => Deno.env.get('GOOGLE_BOOKS_API_KEY'),
  }),
  cache: {
    async get(key) {
      const { data, error } = await supabase.from('google_books_cache').select('status, volumes, expires_at').eq('cache_key', key).maybeSingle<CacheRow>()
      if (error) throw new Error(error.message)
      return data ? { status: data.status, volumes: data.volumes, expiresAt: Date.parse(data.expires_at) } : null
    },
    async put(key, status, volumes, ttlSeconds) {
      const now = Date.now()
      const { error } = await supabase.from('google_books_cache').upsert({
        cache_key: key,
        status,
        volumes: status === 'found' ? volumes : [],
        fetched_at: new Date(now).toISOString(),
        expires_at: new Date(now + ttlSeconds * 1000).toISOString(),
      })
      if (error) throw new Error(error.message)
    },
  },
  catalogue: {
    find: catalogueBook,
    async insert(volume) {
      const { data, error } = await supabase
        .from('books')
        .insert({
          title: volume.title,
          authors: volume.authors,
          isbn13: volume.isbn13,
          isbn10: volume.isbn10,
          page_count: volume.pageCount,
          published_year: volume.year,
          language: volume.language,
          publisher: volume.publisher,
          // Linked, never copied: the address stays Google's (and stays out of the cover store's allow-list).
          cover_url: volume.coverUrl,
          source: 'import',
        })
        .select('*')
        .single<BookRow>()
      if (!error) return data
      // Another call made it first (the ISBN is unique among Catalogue Books): that one is the Book.
      const first = volume.isbn13 ? await catalogueBook(volume.isbn13) : null
      if (first) return first
      throw new Error(error.message)
    },
  },
  configured: () => Boolean(Deno.env.get('GOOGLE_BOOKS_API_KEY')?.trim()),
  async budget(limit) {
    const { data, error } = await supabase.rpc('google_books_budget_take', { p_limit: limit })
    if (error) throw new Error(error.message)
    return data === true
  },
  // The service role on `apikey` (production's `sb_secret_…` key) or as the bearer token, else a member: _shared/caller.ts.
  authorize: createCallerCheck({
    serviceKey,
    async member(token) {
      const { data, error } = await supabase.auth.getUser(token)
      return !error && data.user ? data.user.id : null
    },
  }),
  async throttle(member, budget: Budget) {
    const { data, error } = await supabase.rpc('edge_rate_hit', {
      p_member: member,
      p_bucket: budget.bucket,
      p_limit: budget.limit,
      p_window_seconds: MEMBER_WINDOW_SECONDS,
    })
    if (error) throw new Error(error.message)
    return data === true
  },
  fallbackTtlSeconds: fallbackSeconds,
})

Deno.serve(handler)
