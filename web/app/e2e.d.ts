/** True in the Playwright flows' build only (nuxt.config.ts, vite.define): the hooks the flows need. */
declare const __LIBELLUS_E2E__: boolean

/** The real Realtime client under another name (realtime.config.ts): only the import job's feed loads it (data/importJobFeed.ts). */
declare module '#realtime-client' {
  export { RealtimeClient } from '@supabase/realtime-js'
}
