/**
 * The `dnb-lookup` edge function: handler.ts with the real DNB (client.ts: identified, five requests
 * a second at most, four seconds each, a breaker), Open Library for a cover by ISBN, the Catalogue
 * (written as the service role) and the member check. README.md says how to run and deploy it.
 *
 * `verify_jwt` is off (supabase/config.toml): the function checks the caller itself, so it works
 * with either kind of API key. A signed-in member's access token passes, and so does the
 * service-role key; the anon key does not.
 */
import { createClient } from '@supabase/supabase-js'
import type { DnbEdition } from '../../../web/app/data/dnbRecord.ts'
import { createDnb, userAgent } from './client.ts'
import { type BookRow, type Caller, createHandler, MEMBER_LIMIT, MEMBER_WINDOW_SECONDS } from './handler.ts'
import { sameSecret } from './secret.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('dnb-lookup needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const agent = userAgent(Deno.env.get('LIBELLUS_SITE_URL'))

async function catalogueBook(isbn13: string): Promise<BookRow | null> {
  const { data, error } = await supabase.from('books').select('*').is('owner_id', null).eq('isbn13', isbn13).maybeSingle<BookRow>()
  if (error) throw new Error(error.message)
  return data
}

const handler = createHandler({
  dnb: createDnb({ fetch: (input, init) => fetch(input, init), userAgent: agent }),
  catalogue: {
    find: catalogueBook,
    async insert(edition: DnbEdition, cover) {
      const { data, error } = await supabase
        .from('books')
        .insert({
          title: edition.title,
          authors: edition.authors,
          isbn13: edition.isbn13,
          page_count: edition.pages,
          published_year: edition.year,
          language: edition.language,
          publisher: edition.publisher,
          cover_url: cover?.coverUrl ?? null,
          cover_thumbhash: cover?.coverThumbhash ?? null,
          cover_dominant: cover?.dominant ?? null,
          cover_secondary: cover?.secondary ?? null,
          source: 'import',
        })
        .select('*')
        .single<BookRow>()
      if (!error) return data
      // Another call made it first (the ISBN is unique among Catalogue Books): that one is the Book.
      const first = await catalogueBook(edition.isbn13)
      if (first) return first
      throw new Error(error.message)
    },
  },
  async cover(isbn13) {
    // Open Library answers 404 for an ISBN with no cover (`default=false`); nothing is downloaded.
    try {
      const response = await fetch(`https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`, {
        method: 'HEAD',
        headers: { 'user-agent': agent },
        signal: AbortSignal.timeout(3000),
      })
      return response.ok ? `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg` : null
    } catch {
      return null
    }
  },
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
      p_bucket: 'dnb-lookup',
      p_limit: MEMBER_LIMIT,
      p_window_seconds: MEMBER_WINDOW_SECONDS,
    })
    if (error) throw new Error(error.message)
    return data === true
  },
})

Deno.serve(handler)
