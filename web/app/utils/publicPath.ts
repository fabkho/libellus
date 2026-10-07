/**
 * The addresses anyone may open, signed in or not: a member's public reading page and its Book
 * cards (`/r/<token>`, `/r/<token>/book/<book id>`, issue #171). The auth middleware lets them
 * through without a redirect, and the service worker leaves them to the network (nuxt.config.ts,
 * `navigateFallbackDenylist`), so the Pages Function in front of them (web/functions/r/[[path]].js)
 * answers with the link preview's tags and a real 404 for a dead link. Tiny and framework-free:
 * the middleware runs it on every navigation, so it sits in the app's entry.
 */
export const PUBLIC_PATH = /^\/r(\/|$)/

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATH.test(path)
}
