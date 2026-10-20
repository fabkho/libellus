import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Realtime for the import job (proposal #329, part 5; app/data/importJobFeed.ts). supabase-js builds a Realtime client in every
 * client, so `@supabase/realtime-js` is aliased to a stub (nuxt.config.ts, vitest.config.ts: app/data/realtimeStub.ts) and its ~95 KB
 * stay out of the entry. The REAL client is the app's own dependency, imported under another name (`#realtime-client`) from one place
 * only (the job feed, `import('#realtime-client')`, while a job of hers is live), so the bundler splits it into a chunk nobody
 * downloads until then. The alias points at the package's ES module build, found from its package.json (the package has no
 * `exports` map to resolve it by).
 */
export const REALTIME_STUB = fileURLToPath(new URL('./app/data/realtimeStub.ts', import.meta.url))
export const REALTIME_CLIENT = join(dirname(createRequire(import.meta.url).resolve('@supabase/realtime-js/package.json')), 'dist/module/index.js')
