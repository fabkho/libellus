/**
 * The addresses of the one live instance. `betterreads.de` is the main address; `libellus.fabkho.dev` is the first
 * one and stays a working alias (both are custom domains of the same Cloudflare Pages project, the same build; an
 * installed app, a session and a link someone already holds on the old address keep working there). Docs/HOSTING.md,
 * "The domains".
 *
 * Pure and without imports: the Pages Functions load it as it is, the app and the tests, too.
 */

/** The main address: what a link the app makes for someone else points at. */
export const CANONICAL_HOST = 'betterreads.de'

/** The hosts of the same instance that are not the main one. Never removed while a link or an installed app may still use one. */
export const ALIAS_HOSTS: readonly string[] = ['libellus.fabkho.dev']

/** Whether this is a host of the live instance, the main one or an alias. */
export function isSiteHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === CANONICAL_HOST || ALIAS_HOSTS.includes(host)
}

/**
 * The origin a link to hand to someone else (a follow link, a buddy read's invite, a reading page or a card) is built on:
 * the main address when the app is open on any host of the instance, so a link made on the old address is the new one;
 * the page's own origin everywhere else (`localhost`, a Pages preview, another instance of the code), where the main
 * address would lead to a different app.
 */
export function canonicalOrigin(origin: string): string {
  if (!URL.canParse(origin)) return origin
  const url = new URL(origin)
  return url.protocol === 'https:' && !url.port && isSiteHost(url.hostname) ? `https://${CANONICAL_HOST}` : origin
}
