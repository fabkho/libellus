/**
 * Whether this build carries buddy reads at all (`runtimeConfig.public.buddyReads`, nuxt.config.ts:
 * `NUXT_PUBLIC_BUDDY_READS`, `on` to turn it on; unset, off). Decided at build time, like the Hardcover zip
 * (`useImportZip`) and the cover hosts, because the feature ships in pieces: the database and the data layer
 * are live long before the screens, and a release of main for something else must not show a switch that
 * leads nowhere. Read in a setup, not after an `await`.
 *
 * Everything of the feature asks this first — the Profile's switch row (`stores/buddyReadsSwitch.ts` holds
 * it too, so the store answers `available` and refuses to turn itself on), and every entry point the later
 * screens add (the Book page's row, the Home card, invitations, `/together/*` and `/t/*`). With it off,
 * nothing of buddy reads exists and nothing calls a buddy RPC.
 */
export function useBuddyReadsFlag(): boolean {
  return useRuntimeConfig().public.buddyReads === 'on'
}
