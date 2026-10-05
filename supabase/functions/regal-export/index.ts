/**
 * The `regal-export` edge function (issue #110): handler.ts with the real
 * Library (read with the service role) and the real published file. README.md
 * says how to run, configure and deploy it.
 *
 * `verify_jwt` is off (supabase/config.toml): the caller is the Regal workflow,
 * which has no Supabase key, only the shared secret `REGAL_EXPORT_TOKEN`; the
 * handler checks it.
 */
import { createClient } from '@supabase/supabase-js'
import { configFromEnv, createHandler, loadPublished } from './handler.ts'
import { findMemberId, readLibrary } from './library.ts'

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('regal-export needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

Deno.serve(createHandler({
  config: configFromEnv((name) => Deno.env.get(name)),
  async readLibrary(email) {
    const memberId = await findMemberId(supabase, email)
    return memberId ? await readLibrary(supabase, memberId) : null
  },
  loadPublished: (published) => loadPublished(published),
  now: () => new Date(),
}))
