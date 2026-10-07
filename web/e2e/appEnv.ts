import { stack } from '../tests/support/stack'
import { SHELF_LIBRARY_SRC, SHELF_OWNER_ID } from './shelfOwner'

/** Where the flows' build and its server put their output (nuxt.config.ts, nitro.output.dir with LIBELLUS_E2E). */
export const E2E_OUTPUT = new URL('../.output-e2e/public/', import.meta.url)

/**
 * The app's configuration in the flows, the same for the build they run on (e2e/build.ts), the
 * dev server (LIBELLUS_E2E_DEV=1) and the Pages Functions the static server runs (e2e/serve.mjs).
 * The app talks to whichever stack this checkout started; the anon key is asked of `supabase
 * status` (or given as SUPABASE_ANON_KEY), never read from a file.
 */
export function appEnv(): Record<string, string> {
  return {
    LIBELLUS_E2E: '1',
    NUXT_PUBLIC_SUPABASE_URL: stack.url,
    NUXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
    // Your shelf (#23) is one member's: the flows' owner, made with this id (e2e/shelf.spec.ts).
    NUXT_PUBLIC_SHELF_OWNER_ID: SHELF_OWNER_ID,
    // The library file Regal shows, in a build with it (LIBELLUS_REGAL=1): the address e2e/shelf.spec.ts answers.
    NUXT_PUBLIC_REGAL_LIBRARY_SRC: SHELF_LIBRARY_SRC,
  }
}
