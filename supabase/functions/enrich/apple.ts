/**
 * Apple Books' genres for Catalogue Books (issue #168): the iTunes lookup by
 * track id or ISBN, many at once, in English whatever the storefront
 * (`lang=en_us`). Only the genre names are used. Pure, no I/O.
 */

export const ITUNES = 'https://itunes.apple.com'

/** At most this many ids or ISBNs one lookup asks for. */
export const LOOKUP_BATCH = 50

/** The storefronts asked, in order: a Book sold in none of them has no Apple genres. */
export const STOREFRONTS = ['us', 'de', 'gb'] as const

export function lookupUrl(kind: 'id' | 'isbn', values: readonly string[], country: string): string {
  return `${ITUNES}/lookup?${new URLSearchParams({ [kind]: [...values].sort().join(','), country, lang: 'en_us' })}`
}

export type AppleGenres = { trackId: string | null; isbn13: string | null; title: string | null; genres: string[] }

/** Each result's genre names (without the umbrella "Books"), by its track id and ISBN. */
export function parseLookup(body: unknown): AppleGenres[] {
  const results = (body as { results?: Record<string, unknown>[] } | null)?.results
  if (!Array.isArray(results)) return []
  return results.map((item) => ({
    trackId: typeof item.trackId === 'number' || typeof item.trackId === 'string' ? String(item.trackId) : null,
    isbn13: typeof item.isbn === 'string' && /^97[89]\d{10}$/.test(item.isbn) ? item.isbn : null,
    title: typeof item.trackName === 'string' ? item.trackName : null,
    genres: Array.isArray(item.genres)
      ? item.genres.filter((g): g is string => typeof g === 'string' && g.trim() !== '' && g !== 'Books')
      : [],
  }))
}
