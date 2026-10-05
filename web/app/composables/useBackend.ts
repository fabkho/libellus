import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseClient } from '@/data/createSupabaseClient'
import { createProbe } from '@/data/network'

let client: SupabaseClient | null = null

/**
 * The one Supabase client. Repositories receive it from the stores that build
 * them; pages and components never call it directly. Null when the config is
 * incomplete, so the caller can say which value is missing.
 *
 * A write that gets no answer (data/network.ts) tells `useOnline`, which then
 * counts the device as offline for writes until the backend answers its probe.
 */
export function useBackend(): SupabaseClient | null {
  if (client) return client
  const parsed = parseAppConfig(useRuntimeConfig().public)
  if (!parsed.ok) return null
  const { supabaseUrl, supabaseAnonKey } = parsed.config
  registerProbe(createProbe(supabaseUrl, supabaseAnonKey))
  client = createSupabaseClient(supabaseUrl, supabaseAnonKey, undefined, {
    watch: { onAnswer: reportAnswer, onNoAnswer: reportNoAnswer },
  })
  return client
}
