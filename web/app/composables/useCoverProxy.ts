/**
 * Whether covers are asked for through our own cache (`/cover`, functions/cover.js) instead of the cover host's address.
 * Decided at build time (`runtimeConfig.public.coverProxy`, nuxt.config.ts): on in a Cloudflare Pages build, where the
 * Function exists, off everywhere else (`nuxt dev`, the e2e build, a static host without Functions). A cover that does
 * not come through the cache (a 502, no Function) tries the host's own address next (`coverChain`, utils/cover.ts).
 *
 * One of the two switches `useCoverHosts()` reads (composables/useCoverHosts.ts); a cover of a Book is drawn through
 * `coverImage` / `coverAt` (utils/coverRef.ts), which take those hosts. Only an address with no Book behind it (a search
 * result's, an edition's, the import's) is asked for with `coverSrc(url, size, useCoverProxy())`.
 */
export function useCoverProxy(): boolean {
  return useRuntimeConfig().public.coverProxy === 'on'
}
