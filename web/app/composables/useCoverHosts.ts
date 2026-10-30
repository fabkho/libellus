import type { CoverHosts } from '../utils/coverRef'

/**
 * Where covers come from on this build, for `coverImage` / `coverAt` (utils/coverRef.ts): `proxy` is our edge cache of the
 * two hosts (`/cover`, `useCoverProxy`), `own` our stored copies (`/c/…`, functions/c/[[path]].js). Decided at build time
 * (`runtimeConfig.public.ownCovers`, nuxt.config.ts: `NUXT_PUBLIC_OWN_COVERS`, `on` to turn the copies on; unset, off
 * everywhere, so a build without it shows today's addresses). Turning it on is a rebuild, never a release.
 *
 * ```vue
 * const covers = coverImage(book, 'sm', useCoverHosts())
 * ```
 */
export function useCoverHosts(): Required<CoverHosts> {
  return { proxy: useCoverProxy(), own: useRuntimeConfig().public.ownCovers === 'on' }
}
