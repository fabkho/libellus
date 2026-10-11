import { IMPRINT_ENABLED } from '~/legal/config'

/**
 * The addresses anyone may open, signed in or not: a member's public reading page and its Book
 * cards (`/r/<token>`, `/r/<token>/book/<book id>`, issue #171), and the privacy notice and, once
 * `IMPRINT_ENABLED` (legal/config.ts), the imprint (`/privacy`, `/imprint`: they have to be readable before
 * there is an account). The auth
 * middleware lets them through without a redirect. The reading pages are left to the network by the
 * service worker (nuxt.config.ts, `navigateFallbackDenylist`), so the Pages Function in front of
 * them (web/functions/r/[[path]].js) answers with the link preview's tags and a real 404 for a dead
 * link; the legal pages are static files, precached like the rest of the app, so they open
 * offline. Tiny and framework-free: the middleware runs it on every navigation, so it sits in the
 * app's entry.
 */
export const PUBLIC_PATH = IMPRINT_ENABLED ? /^\/(r|privacy|imprint)(\/|$)/ : /^\/(r|privacy)(\/|$)/

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATH.test(path)
}
