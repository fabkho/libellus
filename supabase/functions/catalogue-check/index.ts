/**
 * The `catalogue-check` edge function (social v2a contract §5): reads unchecked Catalogue Books at
 * their source (Apple, Open Library) and stores what the source says. handler.ts with the real
 * store (the service-role RPCs of the catalogue-check migration), the real sources (the enrich
 * function's polite http client, behind a host allowlist) and the caller check. README.md says how
 * to run and deploy it.
 *
 * `verify_jwt` is off (supabase/config.toml): the function checks the caller itself. Only the
 * service-role key and the shared secret CATALOGUE_CHECK_TOKEN (what pg_cron's call sends) pass; a
 * signed-in member's token does not.
 */
import { createClient } from '@supabase/supabase-js'
import { createHttp } from '../enrich/http.ts'
import { createHandler } from './handler.ts'
import { safeFetch } from './safe_fetch.ts'
import { createSupabaseStore } from './store.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('catalogue-check needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
const checkToken = Deno.env.get('CATALOGUE_CHECK_TOKEN')?.trim() || null

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const site = Deno.env.get('LIBELLUS_SITE_URL')?.trim()
const contact = Deno.env.get('ENRICH_CONTACT')?.trim() || 'https://github.com/fabkho/libellus'
const http = createHttp({
  fetch: safeFetch((input, init) => fetch(input, init)),
  userAgent: `Libellus/1.0 (private book tracker; ${site ? `+${site}; ` : ''}${contact}) catalogue-check`,
})

const handler = createHandler({
  store: createSupabaseStore(supabase),
  http,
  authorize: (request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    return Promise.resolve(Boolean(token) && (token === serviceKey || (checkToken !== null && token === checkToken)))
  },
})

Deno.serve(handler)
