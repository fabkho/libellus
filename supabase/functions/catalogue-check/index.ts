/**
 * The `catalogue-check` edge function (social v2a contract §5): reads unchecked Catalogue Books at
 * their source (Apple, Open Library) and stores what the source says. handler.ts with the real
 * store (the service-role RPCs of the catalogue-check migration), the real sources (the enrich
 * function's polite http client, behind a host allowlist) and the caller check. README.md says how
 * to run and deploy it.
 *
 * `verify_jwt` is off (supabase/config.toml): the function checks the caller itself (authorize.ts). Only the
 * service-role key and the shared secret CATALOGUE_CHECK_TOKEN (what pg_cron's call sends; 32 characters
 * at least, else ignored; compared in constant time) pass; a signed-in member's token does not.
 */
import { createClient } from '@supabase/supabase-js'
import { createHttp } from '../enrich/http.ts'
import { createAuthorize, MIN_TOKEN_LENGTH, usableToken } from './authorize.ts'
import { createHandler } from './handler.ts'
import { safeFetch } from './safe_fetch.ts'
import { createSupabaseStore } from './store.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('catalogue-check needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
const checkToken = usableToken(Deno.env.get('CATALOGUE_CHECK_TOKEN'))
if (Deno.env.get('CATALOGUE_CHECK_TOKEN')?.trim() && checkToken === null) {
  console.error(`catalogue-check: CATALOGUE_CHECK_TOKEN is under ${MIN_TOKEN_LENGTH} characters and is ignored: only the service-role key may call`)
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

/** The most one source response is read to. */
const MAX_RESPONSE_BYTES = 1024 * 1024

const site = Deno.env.get('LIBELLUS_SITE_URL')?.trim()
const contact = Deno.env.get('ENRICH_CONTACT')?.trim() || 'https://github.com/fabkho/libellus'
const http = createHttp({
  fetch: safeFetch((input, init) => fetch(input, init)),
  userAgent: `Libellus/1.0 (private book tracker; ${site ? `+${site}; ` : ''}${contact}) catalogue-check`,
  // A record from a source we do not control is read to 1 MB and no further.
  maxBytes: MAX_RESPONSE_BYTES,
})

const handler = createHandler({
  store: createSupabaseStore(supabase),
  http,
  authorize: createAuthorize(serviceKey, checkToken),
})

Deno.serve(handler)
