import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseClient } from '@/data/createSupabaseClient'

let client: SupabaseClient | null = null

/**
 * The one Supabase client. Repositories receive it from the stores that build
 * them; pages and components never call it directly. Null when the config is
 * incomplete, so the caller can say which value is missing.
 */
export function useBackend(): SupabaseClient | null {
  if (client) return client
  const parsed = parseAppConfig(useRuntimeConfig().public)
  if (!parsed.ok) return null
  client = createSupabaseClient(parsed.config.supabaseUrl, parsed.config.supabaseAnonKey)
  return client
}
