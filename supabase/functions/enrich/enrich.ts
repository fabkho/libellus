/**
 * What the function finds out about a Book and its authors (issues #166–#168),
 * as one payload for `enrich_save` (supabase/migrations/…_enrichment_queue.sql).
 *
 * A Book:
 *   1. Open Library: its work, by the Book's own keys, else its ISBN, else a
 *      title + first-author search; the work's authors, subjects, Wikidata id,
 *      series; the edition's free-text series.
 *   2. Wikidata: the work item, by Open Library's link, else `P648 = <work key>`,
 *      else a title search among the first author's works. An edition item leads
 *      to its work (P629). Series with ordinals (P179/P1545), genres (P136), kind.
 *   3. Its series' other works (SPARQL), so the Book page can show neighbours.
 *      Without Wikidata: Open Library's series, else the edition's series text.
 *   4. Its credited names linked to authors (Open Library's and Wikidata's
 *      authors of the work, matched by name: translators stay unlinked).
 *   5. Genres: Apple's genre names, Wikidata's genres, Open Library's subjects,
 *      mapped onto the canonical list (web/app/data/enrich/genres.ts).
 *   6. Every linked author whose facts are missing or older than 30 days.
 * An author: Open Library's record, the Wikidata item (life dates, portrait on
 * Commons with its licence, Wikipedia intro per language), the works
 * (Wikidata's list with series, merged with Open Library's, which brings
 * covers and an edition per language).
 *
 * A source that fails throws (SourceUnavailable): the Book goes back into the
 * queue. A source that answers "nothing" is a miss, and the Book is stored
 * with what the others found.
 */
import {
  GENRE_MAP_VERSION,
  type GenreSignal,
  mapGenres,
  type RankedGenre,
} from '../../../web/app/data/enrich/genres.ts'
import { LOOKUP_BATCH, STOREFRONTS } from './apple.ts'
import { mainTitle, namesMatch, searchTitle, titlesMatch } from './match.ts'
import * as ol from './openlibrary.ts'
import type { Sources } from './sources.ts'
import * as wd from './wikidata.ts'
import type { PhotoCredit } from './wikimedia.ts'

// ------------------------------------------------------------------ payload

/** An author by what identifies them; the name is what a new row is called. */
export type AuthorRef = { wikidata?: string | null; openlibrary?: string | null; name: string }

export type AuthorPayload = AuthorRef & {
  fetched?: boolean
  worksFetched?: boolean
  birthDate?: string | null
  birthPrecision?: number | null
  deathDate?: string | null
  deathPrecision?: number | null
  photoUrl?: string | null
  photoCredit?: PhotoCredit | null
  summaries?: Record<string, { text: string; title: string; url: string }>
}

export type SeriesPayload = {
  wikidata?: string | null
  openlibrary?: string | null
  name?: string | null
  parent?: SeriesPayload | null
  fetched?: boolean
}

export type WorkPayload = {
  wikidata?: string | null
  openlibrary?: string | null
  title: string
  titles?: Record<string, string>
  year?: number | null
  kind?: wd.WorkKind | null
  coverUrl?: string | null
  editions?: Record<string, { title: string | null; isbn13: string | null; openlibrary_edition_key: string | null; cover_url: string | null }>
  genres?: string[]
  authors?: AuthorRef[]
  series?: { series: SeriesPayload; position: number | null; source: 'wikidata' | 'openlibrary' }[]
  fetched?: boolean
}

export type BookPayload = {
  id: string
  work: WorkPayload | null
  matchedBy: 'openlibrary' | 'isbn' | 'title' | null
  authors: { position: number; author: AuthorRef }[]
  genres: (RankedGenre & { rank: number })[]
  mapVersion: number
  status: 'enriched' | 'not_found'
  sources: string[]
  signals: GenreSignal[]
}

export type Payload = {
  authors: AuthorPayload[]
  series: SeriesPayload[]
  works: WorkPayload[]
  book?: BookPayload
}

/** The columns of a Catalogue Book the enrichment reads. */
export type BookRow = {
  id: string
  title: string
  authors: string[]
  isbn13: string | null
  isbn10: string | null
  language: string | null
  apple_id: string | null
  openlibrary_edition_key: string | null
  openlibrary_work_key: string | null
}

export type EnrichContext = {
  sources: Sources
  /** Whether the author's facts and works were fetched within the TTL. */
  authorFresh: (ref: AuthorRef) => Promise<boolean>
  /** Whether the series' works were fetched within the TTL. */
  seriesFresh: (wikidata: string) => Promise<boolean>
}

const MAX_AUTHOR_WORKS = 300

export function emptyPayload(): Payload {
  return { authors: [], series: [], works: [] }
}

function merge(into: Payload, from: Payload) {
  into.authors.push(...from.authors)
  into.series.push(...from.series)
  into.works.push(...from.works)
}

// -------------------------------------------------------------------- Apple

/**
 * Apple's genre names for a batch of Books: by track id where the Book has
 * one (every storefront in turn, for the ids not found yet), else by ISBN,
 * matched back by title (the ISBN lookup does not say which ISBN a result is).
 */
export async function appleGenres(books: readonly BookRow[], sources: Sources): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const byId = new Map(books.filter((b) => b.apple_id).map((b) => [b.apple_id!, b]))
  for (const country of STOREFRONTS) {
    const missing = [...byId.keys()].filter((id) => !out.has(byId.get(id)!.id))
    for (let i = 0; i < missing.length; i += LOOKUP_BATCH) {
      for (const found of await sources.appleLookup('id', missing.slice(i, i + LOOKUP_BATCH), country)) {
        const book = found.trackId ? byId.get(found.trackId) : undefined
        if (book && found.genres.length) out.set(book.id, found.genres)
      }
    }
  }
  const byIsbn = books.filter((b) => !b.apple_id && b.isbn13)
  for (const country of STOREFRONTS.slice(0, 2)) {
    const missing = byIsbn.filter((b) => !out.has(b.id))
    for (let i = 0; i < missing.length; i += LOOKUP_BATCH) {
      const batch = missing.slice(i, i + LOOKUP_BATCH)
      const results = await sources.appleLookup('isbn', batch.map((b) => b.isbn13!), country)
      for (const book of batch) {
        const found = results.find((r) => r.isbn13 === book.isbn13) ?? results.find((r) => titlesMatch(r.title, book.title))
        if (found?.genres.length) out.set(book.id, found.genres)
      }
    }
  }
  return out
}

// --------------------------------------------------------------------- Book

type AuthorCandidate = { ref: AuthorRef; names: string[] }

export async function enrichBook(
  book: BookRow,
  ctx: EnrichContext,
  apple: readonly string[] = [],
): Promise<Payload> {
  const { sources } = ctx
  const payload = emptyPayload()
  const used = new Set<string>()
  const signals: GenreSignal[] = apple.map((value) => ({ source: 'apple', value }))
  if (apple.length) used.add('apple')
  const firstAuthor = book.authors[0] ?? null

  // 1. Open Library ------------------------------------------------------
  let matchedBy: BookPayload['matchedBy'] = null
  let olWork: ol.OlWork | null = null
  let edition: ol.OlEdition | null = null
  if (book.openlibrary_edition_key) edition = await sources.olEdition(book.openlibrary_edition_key)
  else if (book.isbn13) edition = await sources.olEditionByIsbn(book.isbn13)
  else if (book.isbn10) edition = await sources.olEditionByIsbn(book.isbn10)
  // Open Library files an ISBN under the wrong book now and then (Dune Messiah's ebook under
  // Dune): an edition found by ISBN counts only when its title is the Book's.
  if (edition && !book.openlibrary_edition_key && edition.title && !titlesMatch(edition.title, book.title)) edition = null

  const workKey = book.openlibrary_work_key ?? edition?.workKey ?? null
  if (workKey) {
    olWork = await sources.olWork(workKey)
    if (olWork) matchedBy = book.openlibrary_work_key || book.openlibrary_edition_key ? 'openlibrary' : 'isbn'
  }
  if (!olWork && firstAuthor) {
    const docs = await sources.olTitleSearch(searchTitle(book.title), firstAuthor)
    const doc = docs.find((d) => titlesMatch(d.title, book.title) && d.authorNames.some((n) => namesMatch(n, firstAuthor)))
    if (doc) {
      olWork = await sources.olWork(doc.key)
      if (olWork) matchedBy = 'title'
    }
  }
  if (olWork) {
    used.add('openlibrary')
    for (const subject of olWork.subjects) signals.push({ source: 'openlibrary', value: subject })
  }
  for (const subject of edition?.subjects ?? []) signals.push({ source: 'openlibrary', value: subject })

  const olAuthors: ol.OlAuthor[] = []
  for (const key of (olWork?.authorKeys ?? edition?.authorKeys ?? []).slice(0, 4)) {
    const author = await sources.olAuthor(key)
    if (author) olAuthors.push(author)
  }

  // 2. Wikidata ----------------------------------------------------------
  let work: wd.WorkFacts | null = null
  const candidates: string[] = [...(olWork?.wikidata ?? [])]
  if (!candidates.length && olWork) candidates.push(...(await sources.wdSearch(`haswbstatement:P648=${olWork.key}`, 3)))
  let titleSearched = false
  if (!candidates.length && firstAuthor) {
    const authorQid = olAuthors.find((a) => namesMatch(a.name, firstAuthor))?.wikidata ??
      (await findPersonQid(sources, firstAuthor))
    if (authorQid) {
      titleSearched = true
      candidates.push(...(await sources.wdSearch(`${searchTitle(book.title)} haswbstatement:P50=${authorQid}`, 5)))
    }
  }
  if (candidates.length) {
    const entities = await sources.wdEntities(candidates.slice(0, 5), ['labels', 'claims'])
    for (const qid of candidates.slice(0, 5)) {
      const entity = entities.get(qid)
      if (!entity) continue
      let facts = wd.parseWork(entity, sources.languages)
      if (wd.isEdition(facts) && facts.editionOf[0]) {
        const parent = (await sources.wdEntities([facts.editionOf[0]], ['labels', 'claims'])).get(facts.editionOf[0])
        if (!parent) continue
        facts = wd.parseWork(parent, sources.languages)
      }
      // The item must be this Book's work: its title (in any language asked) is the Book's or Open
      // Library's work's. Links between the sources are sometimes wrong (Open Library linked Dune
      // Messiah to Dune's item).
      const names = [facts.title, ...Object.values(facts.titles)]
      if (!names.some((t) => titlesMatch(t, book.title) || (!titleSearched && titlesMatch(t, olWork?.title)))) continue
      work = facts
      if (!matchedBy) matchedBy = 'title'
      break
    }
  }
  if (work) {
    used.add('wikidata')
    const genreLabels = await labelsOf(sources, work.genres)
    for (const id of work.genres) signals.push({ source: 'wikidata', id, value: genreLabels.get(id) ?? id })
  }

  // 3. Series ------------------------------------------------------------
  const series: NonNullable<WorkPayload['series']> = []
  if (work?.series.length) {
    const stale: string[] = []
    for (const place of work.series) if (!(await ctx.seriesFresh(place.series))) stale.push(place.series)
    const facts = new Map((await sources.wdSeries(stale)).map((s) => [s.qid, s]))
    // An item without a label in the languages asked for (it happens: Harry Potter's series lost its
    // English and German labels in October 2026) is named after Open Library's series when it is the
    // work's only one, else after a label in any language.
    for (const qid of stale.filter((q) => !facts.get(q)?.name)) {
      const known = facts.get(qid)
      let name: string | null = null
      if (work.series.length === 1) {
        name = (olWork?.series[0] ? await sources.olSeriesName(olWork.series[0].key) : null) ??
          edition?.seriesText.map((text) => ol.parseSeriesText(text)?.name).find(Boolean) ?? null
      }
      name ??= known?.otherName ?? null
      if (name) facts.set(qid, { qid, name, otherName: null, parent: known?.parent ?? null })
    }
    for (const place of work.series) {
      series.push({ series: seriesPayload(place.series, facts.get(place.series)), position: place.position, source: 'wikidata' })
    }
    if (stale.length) {
      for (const qid of stale) payload.series.push({ ...seriesPayload(qid, facts.get(qid)), fetched: true })
      for (const member of await sources.wdSeriesWorks(stale)) {
        if (member.qid === work.qid || member.kind === null || member.kind === 'short-story') continue
        payload.works.push(listedWorkPayload(member, facts))
      }
    }
  } else if (olWork?.series.length) {
    for (const place of olWork.series.slice(0, 3)) {
      const name = await sources.olSeriesName(place.key)
      if (name) series.push({ series: { openlibrary: place.key, name }, position: place.position, source: 'openlibrary' })
    }
  }
  if (!series.length) {
    for (const text of edition?.seriesText ?? []) {
      const parsed = ol.parseSeriesText(text)
      if (parsed) {
        series.push({ series: { name: parsed.name }, position: parsed.position, source: 'openlibrary' })
        break
      }
    }
  }

  // 4. Authors -----------------------------------------------------------
  const authorCandidates: AuthorCandidate[] = olAuthors.map((a) => ({
    ref: { openlibrary: a.key, wikidata: a.wikidata, name: a.name ?? a.key },
    names: [a.name, ...a.alternateNames].filter((n): n is string => Boolean(n)),
  }))
  if (work?.authors.length) {
    const missing = work.authors.filter((qid) => !authorCandidates.some((c) => c.ref.wikidata === qid))
    if (missing.length) {
      const names = await labelsOf(sources, missing)
      for (const qid of missing) {
        const name = names.get(qid)
        if (name) authorCandidates.push({ ref: { wikidata: qid, name }, names: [name] })
      }
    }
  }
  const linked: { position: number; author: AuthorRef }[] = []
  book.authors.forEach((name, index) => {
    const match = authorCandidates.find((c) => c.names.some((n) => namesMatch(n, name)))
    if (match) linked.push({ position: index + 1, author: match.ref })
    else if (index === 0) linked.push({ position: 1, author: { name } })
  })

  // 5. Genres ------------------------------------------------------------
  const ranked = mapGenres(signals)
  const workGenres = mapGenres(signals.filter((s) => s.source !== 'apple')).map((g) => g.genre)

  // 6. The work, and the authors to fetch --------------------------------
  let workPayload: WorkPayload | null = null
  if (work || olWork) {
    workPayload = {
      wikidata: work?.qid ?? null,
      openlibrary: olWork?.key ?? null,
      title: work?.title ?? olWork?.title ?? book.title,
      titles: work?.titles ?? {},
      year: work?.year ?? olWork?.year ?? null,
      kind: work?.kind ?? null,
      coverUrl: olWork?.coverId ? ol.coverUrl(olWork.coverId) : null,
      genres: workGenres,
      authors: linked.map((l) => l.author).filter((a) => a.wikidata || a.openlibrary),
      series,
      fetched: true,
    }
  }

  const seen = new Set<string>()
  for (const { author } of linked) {
    if (!author.wikidata && !author.openlibrary) continue
    const key = author.wikidata ?? author.openlibrary!
    if (seen.has(key)) continue
    seen.add(key)
    if (await ctx.authorFresh(author)) continue
    const found = await enrichAuthor(author, ctx)
    merge(payload, found)
    // The author's own record may have found the other key: link the Book with both.
    const full = found.authors[0]
    if (full) {
      author.wikidata = full.wikidata ?? author.wikidata
      author.openlibrary = full.openlibrary ?? author.openlibrary
    }
  }

  payload.book = {
    id: book.id,
    work: workPayload,
    matchedBy: workPayload ? matchedBy ?? 'openlibrary' : null,
    authors: linked,
    genres: ranked.map((g, index) => ({ ...g, rank: index + 1 })),
    mapVersion: GENRE_MAP_VERSION,
    status: workPayload || ranked.length ? 'enriched' : 'not_found',
    sources: [...used].sort(),
    signals,
  }
  return payload
}

/** A person's Wikidata item by name: the first human whose label matches. */
async function findPersonQid(sources: Sources, name: string): Promise<string | null> {
  const hits = await sources.wdSearch(`${name} haswbstatement:P31=Q5`, 3)
  if (!hits.length) return null
  const entities = await sources.wdEntities(hits, ['labels'])
  for (const qid of hits) {
    const entity = entities.get(qid)
    if (entity && namesMatch(wd.label(entity, sources.languages), name)) return qid
  }
  return null
}

/** English (else first) labels of items, for genre signals and author names. */
async function labelsOf(sources: Sources, ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const entities = await sources.wdEntities(ids, ['labels'])
  const out = new Map<string, string>()
  for (const [id, entity] of entities) {
    const value = wd.label(entity, ['en', ...sources.languages])
    if (value) out.set(id, value)
  }
  return out
}

function seriesPayload(qid: string, facts: wd.SeriesFacts | undefined): SeriesPayload {
  return {
    wikidata: qid,
    name: facts?.name ?? null,
    parent: facts?.parent ? { wikidata: facts.parent.qid, name: facts.parent.name } : null,
  }
}

function listedWorkPayload(work: wd.ListedWork, series: Map<string, wd.SeriesFacts>): WorkPayload {
  return {
    wikidata: work.qid,
    openlibrary: work.openLibraryIds.length === 1 ? work.openLibraryIds[0] : null,
    title: work.title!,
    titles: work.titles,
    year: work.year,
    kind: work.kind,
    genres: mapGenres(work.genres.map((id) => ({ source: 'wikidata', id, value: id }))).map((g) => g.genre),
    series: work.series.map((place) => ({
      series: seriesPayload(place.series, series.get(place.series)),
      position: place.position,
      source: 'wikidata',
    })),
  }
}

// ------------------------------------------------------------------- Author

/**
 * An author's facts and works. `ref` names them by Wikidata item and/or Open
 * Library id (a name-only author has nothing to look up).
 */
export async function enrichAuthor(ref: AuthorRef, ctx: EnrichContext): Promise<Payload> {
  const { sources } = ctx
  const payload = emptyPayload()
  const olAuthor = ref.openlibrary ? await sources.olAuthor(ref.openlibrary) : null
  let qid = ref.wikidata ?? olAuthor?.wikidata ?? null
  if (!qid && ref.openlibrary) qid = (await sources.wdSearch(`haswbstatement:P648=${ref.openlibrary}`, 1))[0] ?? null
  // Open Library keeps duplicate records of some authors, and Wikidata links only one of them:
  // the person by name (a human whose label matches) then.
  if (!qid) qid = await findPersonQid(sources, olAuthor?.name ?? ref.name)
  const facts = qid ? await sources.wdAuthor(qid) : null
  if (!facts) qid = null
  const openlibrary = ref.openlibrary ?? facts?.openLibraryIds[0] ?? null

  // The portrait: Commons (with its licence), else Open Library's photo.
  let photoUrl: string | null = null
  let photoCredit: PhotoCredit | null = null
  if (facts?.image) {
    const photo = await sources.commonsImage(facts.image)
    if (photo) ({ url: photoUrl, credit: photoCredit } = photo)
  }
  if (!photoUrl && olAuthor?.photoId) {
    photoUrl = ol.authorPhotoUrl(olAuthor.photoId)
    photoCredit = { source: 'openlibrary', fileUrl: `${ol.OPEN_LIBRARY}/authors/${olAuthor.key}` }
  }

  const summaries: NonNullable<AuthorPayload['summaries']> = {}
  for (const [language, title] of Object.entries(facts?.sitelinks ?? {})) {
    const summary = await sources.wikipediaSummary(language, title)
    if (summary) summaries[language] = summary
  }

  const name = facts?.name ?? olAuthor?.name ?? ref.name
  const self: AuthorRef = { wikidata: qid, openlibrary, name }
  payload.authors.push({
    ...self,
    fetched: true,
    worksFetched: true,
    birthDate: facts?.birth?.date ?? null,
    birthPrecision: facts?.birth?.precision ?? null,
    deathDate: facts?.death?.date ?? null,
    deathPrecision: facts?.death?.precision ?? null,
    photoUrl,
    photoCredit,
    summaries,
  })

  // Works: Wikidata's list (with series), Open Library's per language (covers, editions).
  const listed = qid ? (await sources.wdAuthorWorks(qid)).filter((w) => w.kind !== null && w.kind !== 'short-story') : []
  const olDocs = new Map<string, Map<string, ol.OlSearchDoc>>()
  if (openlibrary) {
    for (const language of sources.languages) {
      olDocs.set(language, new Map((await sources.olAuthorWorks(openlibrary, language)).map((d) => [d.key, d])))
    }
  }
  const primary = olDocs.get(sources.languages[0]!) ?? new Map<string, ol.OlSearchDoc>()
  const claimed = new Set<string>()

  const seriesQids = [...new Set(listed.flatMap((w) => w.series.map((s) => s.series)))]
  const staleSeries: string[] = []
  for (const s of seriesQids) if (!(await ctx.seriesFresh(s))) staleSeries.push(s)
  const seriesFacts = new Map((await sources.wdSeries(staleSeries)).map((s) => [s.qid, s]))
  for (const s of staleSeries) payload.series.push(seriesPayload(s, seriesFacts.get(s)))

  for (const work of listed.slice(0, MAX_AUTHOR_WORKS)) {
    const doc = work.openLibraryIds.map((key) => primary.get(key)).find(Boolean) ??
      [...primary.values()].find((d) => !claimed.has(d.key) && [work.title, ...Object.values(work.titles)].some((t) => titlesMatch(d.title, t)))
    if (doc) claimed.add(doc.key)
    payload.works.push({
      ...listedWorkPayload(work, seriesFacts),
      openlibrary: doc?.key ?? (work.openLibraryIds.length === 1 ? work.openLibraryIds[0] : null),
      year: work.year ?? doc?.year ?? null,
      coverUrl: doc?.coverId ? ol.coverUrl(doc.coverId) : null,
      editions: doc ? editionsOf(doc.key, olDocs) : {},
      authors: [self],
      fetched: true,
    })
  }

  // Authors Wikidata barely knows: Open Library's works stand in (most-published first).
  if (listed.length < 3) {
    const titles = new Set(payload.works.map((w) => mainTitle(w.title)))
    for (const doc of primary.values()) {
      if (claimed.has(doc.key) || doc.editionCount < 2 || !doc.title) continue
      const title = mainTitle(doc.title)
      if (titles.has(title)) continue
      titles.add(title)
      payload.works.push({
        openlibrary: doc.key,
        title: doc.title,
        year: doc.year,
        coverUrl: doc.coverId ? ol.coverUrl(doc.coverId) : null,
        editions: editionsOf(doc.key, olDocs),
        authors: [self],
        fetched: true,
      })
      if (payload.works.length >= 60) break
    }
  }
  return payload
}

function editionsOf(key: string, docs: Map<string, Map<string, ol.OlSearchDoc>>): NonNullable<WorkPayload['editions']> {
  const out: NonNullable<WorkPayload['editions']> = {}
  for (const [language, byKey] of docs) {
    const edition = byKey.get(key)?.edition
    if (!edition) continue
    const marc = ol.MARC_LANGUAGES[language] ?? language
    if (edition.language && edition.language !== marc) continue
    out[language] = {
      title: edition.title,
      isbn13: edition.isbn13,
      openlibrary_edition_key: edition.key,
      cover_url: edition.coverId ? ol.coverUrl(edition.coverId) : null,
    }
  }
  return out
}
