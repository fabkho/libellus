/**
 * The `buddy-voice-sweep` edge function: removes the voice messages' audio whose message is gone (a message deleted, a member who
 * left with "also delete my messages", an account or a read deleted) and the uploads that never became a message, from the private
 * bucket `buddy-voice`. README.md says what it needs and how the database finds it.
 *
 * `verify_jwt` is off (supabase/config.toml): the function checks the caller itself (handler.ts).
 *
 *   BUDDY_VOICE_SWEEP_TOKEN    the bearer the database's kick carries (its Vault twin `buddy_voice_sweep_token`)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by the runtime
 */
import { createClient } from '@supabase/supabase-js'
import { createHandler } from './handler.ts'
import { removedNames, sweep } from './sweep.ts'

const BUCKET = 'buddy-voice'
const env = (name: string) => Deno.env.get(name)?.trim() || null

const url = env('SUPABASE_URL')
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('buddy-voice-sweep needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const handler = createHandler({
  token: env('BUDDY_VOICE_SWEEP_TOKEN'),
  run: ({ full }) =>
    sweep({
      batch: async (limit) => {
        const { data, error } = await supabase.rpc('buddy_voice_sweep_batch', { p_limit: limit, p_orphans: full })
        if (error) throw new Error(`buddy_voice_sweep_batch: ${error.message}`)
        return (data as string[] | null) ?? []
      },
      remove: async (paths) => {
        const { data, error } = await supabase.storage.from(BUCKET).remove(paths)
        if (error) throw new Error(`storage: ${error.message}`)
        return removedNames(data)
      },
      done: async (paths) => {
        const { error } = await supabase.rpc('buddy_voice_sweep_done', { p_paths: paths })
        if (error) throw new Error(`buddy_voice_sweep_done: ${error.message}`)
      },
    }),
})

Deno.serve(handler)
