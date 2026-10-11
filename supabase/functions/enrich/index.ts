/**
 * The `enrich` edge function (issues #166–#168): handler.ts with the real
 * store (the service-role RPCs of the enrichment migrations), the real sources
 * (http.ts: identified, rate-limited per host, retried) and the caller check.
 * README.md says how to run and deploy it.
 *
 * `verify_jwt` is off (supabase/config.toml): the function checks the caller
 * itself. The service-role key and the shared secret ENRICH_TOKEN (what
 * pg_cron's call sends) are the service; a signed-in member's access token is
 * a member (only `book` and `author`); anything else is refused.
 */
import { createClient } from '@supabase/supabase-js'
import { type Caller, createHandler, MEMBER_LIMIT, MEMBER_WINDOW_SECONDS } from './handler.ts'
import { createHttp, userAgent } from './http.ts'
import { sameSecret } from './secret.ts'
import { createSources } from './sources.ts'
import { createSupabaseStore } from './store.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('enrich needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
const enrichToken = Deno.env.get('ENRICH_TOKEN')?.trim() || null
const languages = (Deno.env.get('ENRICH_LANGUAGES') ?? 'en,de')
  .split(',')
  .map((lang) => lang.trim().toLowerCase())
  .filter((lang) => /^[a-z]{2}$/.test(lang))

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const http = createHttp({
  fetch: (input, init) => fetch(input, init),
  userAgent: userAgent(Deno.env.get('LIBELLUS_SITE_URL'), Deno.env.get('ENRICH_CONTACT')),
})

const handler = createHandler({
  store: createSupabaseStore(supabase),
  sources: createSources(http, languages.length ? languages : ['en']),
  async authorize(request): Promise<Caller> {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
    if (!token) return null
    if ((await sameSecret(token, serviceKey)) || (enrichToken && (await sameSecret(token, enrichToken)))) return 'service'
    const { data, error } = await supabase.auth.getUser(token)
    return !error && data.user ? { member: data.user.id } : null
  },
  async throttle(member) {
    const { data, error } = await supabase.rpc('edge_rate_hit', {
      p_member: member,
      p_bucket: 'enrich',
      p_limit: MEMBER_LIMIT,
      p_window_seconds: MEMBER_WINDOW_SECONDS,
    })
    if (error) throw new Error(error.message)
    return data === true
  },
})

Deno.serve(handler)
