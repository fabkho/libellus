import type { SupabaseClient } from '@supabase/supabase-js'
import type { GenreId } from './genres'
import { type EnrichResult, mapError, OFFLINE } from './result'
import type { WorkCard } from './works'

/**
 * Author pages (issue #167): the hero, the genre chips and the works grouped
 * (series in reading order, standalone novels, other), each with her status,
 * from the server-side cache the `enrich` edge function keeps (Wikidata, Open
 * Library, Wikipedia, Wikimedia Commons). Opened by any of the author's keys:
 * a Wikidata item (Q46248), an Open Library id (OL25712A) or the row's uuid;
 * a Book's linked authors carry the key (`forBook`).
 *
 * Credits are part of the data: the Wikipedia intro comes with its URL and
 * language ("From Wikipedia", CC BY-SA), the photo with its licence and author.
 * `stale` says the cache is old or the works were never fetched: `refresh`
 * asks the function (online only), then the page is read again.
 */

export type LifeDate = { date: string; precision: 9 | 10 | 11 }

export type AuthorHero = {
  id: string
  /** The key the page is opened by: Wikidata item, else Open Library id, else uuid. */
  key: string
  name: string
  wikidataId?: string
  openLibraryKey?: string
  born?: LifeDate
  died?: LifeDate
  photo?: {
    url: string
    credit: { source: 'commons' | 'openlibrary'; artist?: string | null; licence?: string | null; licenceUrl?: string | null; fileUrl?: string | null } | null
  }
  /** The Wikipedia intro in her language, else English, with what the credit links to. */
  summary?: { text: string; title: string; url: string; language: string }
  fetchedAt?: string
}

export type AuthorSeries = {
  id: string
  name: string
  wikidataId?: string
  parentId?: string
  parentName?: string
  works: WorkCard[]
}

export type AuthorPage = {
  author: AuthorHero
  genres: GenreId[]
  series: AuthorSeries[]
  standalone: WorkCard[]
  other: WorkCard[]
  stale: boolean
}

export type BookAuthor = { position: number; name: string; authorId: string; key: string }

export type AuthorsRepository = {
  /** The author page, or null when no author has that key. */
  page: (key: string, language?: string) => Promise<EnrichResult<AuthorPage | null>>
  /** A Book's linked authors in credit order (translators and introducers are not linked). */
  forBook: (bookId: string) => Promise<EnrichResult<BookAuthor[]>>
  /** Asks the enrich function to fetch the author again if the cache is stale. Answers whether it did. */
  refresh: (key: string) => Promise<EnrichResult<boolean>>
}

export const ENRICH_FUNCTION = 'enrich'

type Invoke = Pick<SupabaseClient, 'functions'>['functions']['invoke']

function numbered(card: WorkCard): WorkCard {
  return card.position === undefined ? card : { ...card, position: Number(card.position) }
}

export function createAuthors(
  client: Pick<SupabaseClient, 'rpc' | 'functions'>,
  { online = () => true }: { online?: () => boolean } = {},
): AuthorsRepository {
  return {
    async page(key, language = 'en') {
      const { data, error } = await client.rpc('author_page', { p_author: key, p_language: language })
      if (error) return { data: null, error: mapError(error) }
      if (!data) return { data: null, error: null }
      const page = data as AuthorPage
      return {
        data: {
          ...page,
          series: page.series.map((s) => ({ ...s, works: s.works.map(numbered) })),
          standalone: page.standalone.map(numbered),
          other: page.other.map(numbered),
        },
        error: null,
      }
    },

    async forBook(bookId) {
      const { data, error } = await client.rpc('book_authors_of', { p_book: bookId })
      if (error) return { data: null, error: mapError(error) }
      const rows = (data ?? []) as { credit_position: number; name: string; author_id: string; author_key: string }[]
      return {
        data: rows.map((r) => ({ position: r.credit_position, name: r.name, authorId: r.author_id, key: r.author_key })),
        error: null,
      }
    },

    async refresh(key) {
      if (!online()) return OFFLINE
      const invoke: Invoke = client.functions.invoke.bind(client.functions)
      const { data, error } = await invoke(ENRICH_FUNCTION, { body: { action: 'author', key } })
      if (error) return { data: null, error: 'unknown' }
      return { data: Boolean((data as { refreshed?: boolean } | null)?.refreshed), error: null }
    },
  }
}
