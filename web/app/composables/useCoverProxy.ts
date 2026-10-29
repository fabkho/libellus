/**
 * Whether covers are asked for through our own cache (`/cover`, functions/cover.js) instead of the cover host's address.
 * Decided at build time (`runtimeConfig.public.coverProxy`, nuxt.config.ts): on in a Cloudflare Pages build, where the
 * Function exists, off everywhere else (`nuxt dev`, the e2e build, a static host without Functions). A cover that does
 * not come through the cache (a 502, no Function) tries the host's own address next (`coverChain`, utils/cover.ts).
 *
 * ```vue
 * <UiCover :src="coverSrc(book.coverUrl, 'sm', useCoverProxy())" … />
 * ```
 */
export function useCoverProxy(): boolean {
  return useRuntimeConfig().public.coverProxy === 'on'
}
