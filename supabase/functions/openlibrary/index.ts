/**
 * The `openlibrary` edge function: handler.ts over the real Open Library (client.ts: identified
 * by `User-Agent: Libellus/1.0 (<contact>)`, at most three requests a second across every
 * instance and member: one pace booked in Postgres (../_shared/pace.ts), a deadline under the
 * client's), with the member check and the per-member budget.
 * README.md says how to run and deploy it.
 *
 * `verify_jwt` is off (supabase/config.toml): the function checks the caller itself, so it works
 * with either kind of API key. A signed-in member's access token passes, and so does the
 * service-role key; the anon key does not.
 *
 * The contact address Open Library is given (`OPENLIBRARY_CONTACT`, a function secret set on
 * deploy, never in the repository) is what makes this an identified client (3 requests/s instead
 * of 1). Without it the function refuses to run: an unidentified proxy would quietly keep the
 * import on the lower limit, and Open Library asks for a way to reach whoever runs the client.
 */
import { createClient } from '@supabase/supabase-js'
import { sharedPace } from '../_shared/pace.ts'
import { createOpenLibrary, MIN_INTERVAL_MS, PACE_MAX_WAIT_MS, userAgent } from './client.ts'
import { type Caller, createHandler, MEMBER_LIMIT, MEMBER_WINDOW_SECONDS } from './handler.ts'
import { sameSecret } from './secret.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('openlibrary needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
const contact = Deno.env.get('OPENLIBRARY_CONTACT')?.trim()
if (!contact) throw new Error('openlibrary needs OPENLIBRARY_CONTACT (the contact address Open Library is given)')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const handler = createHandler({
  openlibrary: createOpenLibrary({
    fetch: (input, init) => fetch(input, init),
    userAgent: userAgent(contact),
    // One pace for every instance and member (a turn booked in Postgres, supabase/migrations/20261030010000_edge_pace.sql).
    pace: sharedPace({
      rpc: (name, args) => supabase.rpc(name, args),
      bucket: 'openlibrary',
      gapMs: MIN_INTERVAL_MS,
      maxWaitMs: PACE_MAX_WAIT_MS,
    }),
  }),
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
      p_bucket: 'openlibrary',
      p_limit: MEMBER_LIMIT,
      p_window_seconds: MEMBER_WINDOW_SECONDS,
    })
    if (error) throw new Error(error.message)
    return data === true
  },
})

Deno.serve(handler)
