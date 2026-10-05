import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { withWriteTimeout, type NetworkWatch } from './network'

/** The storage supabase-js persists a session into. */
export type SessionStorage = {
  getItem: (key: string) => Promise<string | null> | string | null
  setItem: (key: string, value: string) => Promise<void> | void
  removeItem: (key: string) => Promise<void> | void
}

/**
 * One place for the auth options, so the tests build a client that behaves
 * like the app's without restating its configuration. The app uses the
 * browser's localStorage; the tests pass an in-memory one.
 *
 * Writes to the database are given a few seconds to be answered (`network.ts`):
 * a connection that never answers ends them as a network failure instead of
 * hanging, and `watch` hears how each write ended (the app turns that into
 * "offline for writes").
 */
export function createSupabaseClient(
  url: string,
  anonKey: string,
  storage?: SessionStorage,
  { watch, writeTimeoutMs }: { watch?: NetworkWatch; writeTimeoutMs?: number } = {},
): SupabaseClient {
  return createClient(url, anonKey, {
    global: { fetch: withWriteTimeout((input, init) => fetch(input, init), writeTimeoutMs, watch) },
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      // Sign-in is a typed six-digit code, never a magic link, so there is no
      // session to read out of the URL.
      detectSessionInUrl: false,
    },
  })
}
