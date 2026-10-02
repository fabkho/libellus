import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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
 */
export function createSupabaseClient(
  url: string,
  anonKey: string,
  storage?: SessionStorage,
): SupabaseClient {
  return createClient(url, anonKey, {
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
