/**
 * Warming a friend's page before it opens (docs/plans/shared-books-slideshow.md, loading): a tap on a link to her, or her
 * row coming into view, starts the request for "You both read" (and its first covers and the reel's chunk) so they are
 * on their way, or in, when the page opens. Framework-free: the address that names a friend, and how many a screen may
 * warm by itself (a few at most; a tap is always the member's own intent).
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const FRIEND_HREF = new RegExp(`^/friends/(${UUID})/?(?:[?#].*)?$`, 'i')

/** The friend an address leads to (`/friends/<id>`, not her year pages or the tab itself); null for any other. */
export function friendIdOfHref(href: string | null | undefined): string | null {
  const found = href ? FRIEND_HREF.exec(href) : null
  return found ? found[1]!.toLowerCase() : null
}

/** What a screen may warm on its own as rows come into view: at most `limit` friends, each once. */
export function createVisibleWarmBudget(limit = 3) {
  const taken = new Set<string>()
  return {
    /** Whether this friend may be warmed now (and counts it); false when she was, or the budget is spent. */
    take(id: string): boolean {
      if (taken.has(id) || taken.size >= limit) return false
      taken.add(id)
      return true
    },
    get used() {
      return taken.size
    },
  }
}
