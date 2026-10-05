/**
 * Which book page an address shows. A book page whose entry changed to
 * another edition (#41) takes the new Book's address, but stays the same page:
 * it is not drawn afresh, so the change can animate from the old Book to the
 * new one (#61, docs/MOTION.md, Change edition), and the router leaves it
 * where it was scrolled (app/router.options.ts). Framework-free.
 */
import type { RouteLocationNormalizedLoaded } from 'vue-router'

/** A Book's key → the key of the page that first showed its entry here. */
const firsts = new Map<string, string>()
/** Edition changes remembered (a member changes a handful in a session). */
const KEPT = 50

/** The page `key` belongs to: its own, or the page it followed from an edition to this one. */
export function bookPageOf(key: string): string {
  return firsts.get(key) ?? key
}

/** The page showing `from` now shows `to`, another edition of the same entry. */
export function followEdition(from: string, to: string) {
  if (from === to) return
  firsts.set(to, bookPageOf(from))
  if (firsts.size > KEPT) firsts.delete(firsts.keys().next().value!)
}

/** Nuxt's page key for `/book/<key>` (definePageMeta): one per book page, through its edition changes. */
export function bookPageKey(route: Pick<RouteLocationNormalizedLoaded, 'params'>): string {
  return `/book/${bookPageOf(String(route.params.key))}`
}
