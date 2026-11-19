import { createBookCovers, type BookCovers } from '~/data/bookCovers'
import { probeImageInBrowser } from '~/data/covers'
import { useSearchStore } from '~/stores/search'

/**
 * A Book's Cover as this app resolves it: the browser reads the pixels
 * (`probeImageInBrowser`), Apple's edition by ISBN comes from the search
 * repository, and the chain itself is `data/bookCovers.ts`.
 *
 * The lookup is a closure, not a repository kept here: the `Search` repository
 * is made again when the app's language changes (stores/search.ts,
 * `repository`), and a saved instance would ask the old storefront's Apple for
 * every Cover after the switch.
 */
export function useBookCovers(budgetMs?: number): BookCovers {
  return createBookCovers({
    probe: probeImageInBrowser,
    lookupAppleIsbn: (isbn13) => useSearchStore().repository().lookupAppleIsbn(isbn13),
    ...(budgetMs === undefined ? {} : { budgetMs }),
  })
}
