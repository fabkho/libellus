/**
 * The sources as typed calls: the URL builders and parsers of wikidata.ts,
 * openlibrary.ts, wikimedia.ts and apple.ts on top of the polite client
 * (http.ts). One instance per function run; everything it asks goes through
 * the client's per-host limit and short-term cache.
 */
import type { GenreId } from '../../../web/app/data/enrich/genres.ts'
import { type AppleGenres, lookupUrl, parseLookup } from './apple.ts'
import type { Http } from './http.ts'
import * as ol from './openlibrary.ts'
import * as wd from './wikidata.ts'
import { imageInfoUrl, parseImageInfo, parseSummary, type Photo, type Summary, summaryUrl } from './wikimedia.ts'

export type Sources = ReturnType<typeof createSources>

/**
 * Sources that are not a polite HTTP client of their own: `googleGenres` asks the `google-books` function (its key,
 * cache and daily budget stay there) for the app's genres of an ISBN-13; left out, Google is not asked.
 */
export type Extras = { googleGenres?: (isbn13: string) => Promise<readonly GenreId[]> }

export function createSources(http: Http, languages: readonly string[], extras: Extras = {}) {
  return {
    languages,
    googleGenres: extras.googleGenres ?? null,

    // ------------------------------------------------------------ Open Library
    async olEditionByIsbn(isbn: string): Promise<ol.OlEdition | null> {
      return ol.parseEdition(await http.json(ol.isbnUrl(isbn)))
    },
    async olEdition(key: string): Promise<ol.OlEdition | null> {
      return ol.parseEdition(await http.json(ol.editionUrl(key)))
    },
    async olWork(key: string): Promise<ol.OlWork | null> {
      return ol.parseWork(await http.json(ol.workUrl(key)))
    },
    async olAuthor(key: string): Promise<ol.OlAuthor | null> {
      return ol.parseAuthor(await http.json(ol.authorUrl(key)))
    },
    async olSeriesName(key: string): Promise<string | null> {
      return ol.parseSeriesName(await http.json(ol.seriesUrl(key)))
    },
    async olTitleSearch(title: string, author: string): Promise<ol.OlSearchDoc[]> {
      return ol.parseSearch(await http.json(ol.titleSearchUrl(title, author)))
    },
    async olAuthorWorks(author: string, language: string): Promise<ol.OlSearchDoc[]> {
      return ol.parseSearch(await http.json(ol.authorWorksUrl(author, ol.MARC_LANGUAGES[language] ?? language)))
    },

    // ---------------------------------------------------------------- Wikidata
    async wdSearch(query: string, limit = 5): Promise<string[]> {
      return wd.parseSearch(await http.json(wd.searchUrl(query, limit)))
    },
    /** Entities by id, at most 50 a request. */
    async wdEntities(ids: readonly string[], props: readonly string[]): Promise<Map<string, wd.Entity>> {
      const out = new Map<string, wd.Entity>()
      const unique = [...new Set(ids)].filter(wd.isQid)
      for (let i = 0; i < unique.length; i += 50) {
        const found = wd.parseEntities(await http.json(wd.entitiesUrl(unique.slice(i, i + 50), props, languages)))
        for (const [id, entity] of found) out.set(id, entity)
      }
      return out
    },
    async wdAuthor(qid: string): Promise<wd.AuthorFacts | null> {
      return wd.parseAuthorFacts(await http.json(wd.sparqlUrl(wd.authorQuery(qid, languages)), { accept: wd.SPARQL_ACCEPT }), languages)
    },
    async wdAuthorWorks(qid: string): Promise<wd.ListedWork[]> {
      return wd.parseWorks(await http.json(wd.sparqlUrl(wd.authorWorksQuery(qid, languages)), { accept: wd.SPARQL_ACCEPT }), languages)
    },
    async wdSeriesWorks(qids: readonly string[]): Promise<wd.ListedWork[]> {
      if (!qids.length) return []
      return wd.parseWorks(await http.json(wd.sparqlUrl(wd.seriesWorksQuery(qids, languages)), { accept: wd.SPARQL_ACCEPT }), languages)
    },
    async wdSeries(qids: readonly string[]): Promise<wd.SeriesFacts[]> {
      if (!qids.length) return []
      return wd.parseSeries(await http.json(wd.sparqlUrl(wd.seriesQuery(qids, languages)), { accept: wd.SPARQL_ACCEPT }), languages)
    },

    // --------------------------------------------------------------- Wikimedia
    async commonsImage(file: string): Promise<Photo | null> {
      return parseImageInfo(await http.json(imageInfoUrl(file)))
    },
    async wikipediaSummary(language: string, title: string): Promise<Summary | null> {
      return parseSummary(await http.json(summaryUrl(language, title)))
    },

    // ------------------------------------------------------------------ Apple
    async appleLookup(kind: 'id' | 'isbn', values: readonly string[], country: string): Promise<AppleGenres[]> {
      return parseLookup(await http.json(lookupUrl(kind, values, country)))
    },
  }
}
