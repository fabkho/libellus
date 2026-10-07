/**
 * Open Library: the URLs the function asks and the parsing of the answers.
 * Pure, no I/O.
 *
 *   /isbn/<isbn>.json            an edition by ISBN (its work, its free-text `series`)
 *   /books/<OL…M>.json           an edition by key
 *   /works/<OL…W>.json           a work: authors, subjects, `identifiers.wikidata`, `series`
 *   /authors/<OL…A>.json         an author: name, dates, photos, `remote_ids.wikidata`
 *   /series/<OL…L>.json          a series' name
 *   /search.json?title&author    a work by title and author (no ISBN, no key)
 *   /search.json?q=author_key:…  an author's works, with one edition in a language
 *   covers.openlibrary.org       cover and author photo images (URLs only)
 */

export const OPEN_LIBRARY = 'https://openlibrary.org'
export const COVERS = 'https://covers.openlibrary.org'

const WORK_KEY = /^OL[1-9]\d*W$/
const AUTHOR_KEY = /^OL[1-9]\d*A$/
const EDITION_KEY = /^OL[1-9]\d*M$/
const SERIES_KEY = /^OL[1-9]\d*L$/

/** "/works/OL45883W" or "OL45883W" → "OL45883W"; anything else → null. */
export function bareKey(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== 'string') return null
  const key = value.split('/').pop() ?? ''
  return pattern.test(key) ? key : null
}
export const workKey = (value: unknown) => bareKey(value, WORK_KEY)
export const authorKey = (value: unknown) => bareKey(value, AUTHOR_KEY)
export const editionKey = (value: unknown) => bareKey(value, EDITION_KEY)
export const seriesKey = (value: unknown) => bareKey(value, SERIES_KEY)

// ------------------------------------------------------------------- URLs

export const isbnUrl = (isbn: string) => `${OPEN_LIBRARY}/isbn/${isbn}.json`
export const editionUrl = (key: string) => `${OPEN_LIBRARY}/books/${key}.json`
export const workUrl = (key: string) => `${OPEN_LIBRARY}/works/${key}.json`
export const authorUrl = (key: string) => `${OPEN_LIBRARY}/authors/${key}.json`
export const seriesUrl = (key: string) => `${OPEN_LIBRARY}/series/${key}.json`

const SEARCH_FIELDS = 'key,title,author_key,author_name,first_publish_year,cover_i,subject'

/** A work by title and author: the first few candidates. */
export function titleSearchUrl(title: string, author: string): string {
  return `${OPEN_LIBRARY}/search.json?${new URLSearchParams({ title, author, fields: SEARCH_FIELDS, limit: '5' })}`
}

/** Open Library's language codes (MARC) for the app's languages. */
export const MARC_LANGUAGES: Record<string, string> = { en: 'eng', de: 'ger', fr: 'fre', es: 'spa', it: 'ita', nl: 'dut' }

/**
 * An author's works, most-published first, each with its best edition in
 * `language` (Open Library's `lang` picks it): title, ISBN, cover.
 */
export function authorWorksUrl(author: string, language: string, limit = 100): string {
  return `${OPEN_LIBRARY}/search.json?${new URLSearchParams({
    q: `author_key:${author}`,
    fields: 'key,title,first_publish_year,cover_i,edition_count,editions,editions.key,editions.title,editions.language,editions.isbn,editions.cover_i',
    sort: 'editions',
    limit: String(limit),
    lang: language,
  })}`
}

export const coverUrl = (coverId: number, size: 'M' | 'L' = 'L') => `${COVERS}/b/id/${coverId}-${size}.jpg`
export const authorPhotoUrl = (photoId: number) => `${COVERS}/a/id/${photoId}-L.jpg`

// --------------------------------------------------------------- answers

export type OlEdition = {
  key: string | null
  title: string | null
  workKey: string | null
  authorKeys: string[]
  /** The edition's free-text series ("Discworld ; 15"), as given. */
  seriesText: string[]
  subjects: string[]
}

export function parseEdition(body: unknown): OlEdition | null {
  const edition = body as {
    key?: string
    title?: string
    works?: { key?: string }[]
    authors?: { key?: string }[]
    series?: unknown
    subjects?: unknown
  } | null
  if (!edition || typeof edition !== 'object') return null
  return {
    key: editionKey(edition.key),
    title: typeof edition.title === 'string' ? edition.title.trim() : null,
    workKey: workKey(edition.works?.[0]?.key),
    authorKeys: (edition.authors ?? []).map((a) => authorKey(a.key)).filter((k): k is string => k !== null),
    seriesText: strings(edition.series),
    subjects: strings(edition.subjects),
  }
}

export type OlWork = {
  key: string
  title: string | null
  authorKeys: string[]
  subjects: string[]
  wikidata: string[]
  /** Open Library's own series (newer works): key and position. */
  series: { key: string; position: number | null }[]
  coverId: number | null
  year: number | null
}

export function parseWork(body: unknown): OlWork | null {
  const work = body as {
    key?: string
    title?: string
    authors?: { author?: { key?: string } }[]
    subjects?: unknown
    identifiers?: { wikidata?: unknown }
    series?: { series?: { key?: string }; position?: unknown }[]
    covers?: unknown
    first_publish_date?: string
  } | null
  const key = workKey(work?.key)
  if (!work || !key) return null
  const covers = Array.isArray(work.covers) ? work.covers.filter((c): c is number => typeof c === 'number' && c > 0) : []
  const year = Number(work.first_publish_date?.match(/\b(\d{4})\b/)?.[1])
  return {
    key,
    title: typeof work.title === 'string' ? work.title.trim() : null,
    authorKeys: (work.authors ?? []).map((a) => authorKey(a.author?.key)).filter((k): k is string => k !== null),
    subjects: strings(work.subjects),
    wikidata: strings(work.identifiers?.wikidata).filter((id) => /^Q\d+$/.test(id)),
    series: (Array.isArray(work.series) ? work.series : [])
      .map((s) => ({ key: seriesKey(s?.series?.key), position: parsePosition(s?.position) }))
      .filter((s): s is { key: string; position: number | null } => s.key !== null),
    coverId: covers[0] ?? null,
    year: Number.isFinite(year) && year > 0 ? year : null,
  }
}

export type OlAuthor = {
  key: string
  name: string | null
  alternateNames: string[]
  wikidata: string | null
  photoId: number | null
  birth: string | null
  death: string | null
}

export function parseAuthor(body: unknown): OlAuthor | null {
  const author = body as {
    key?: string
    name?: string
    personal_name?: string
    alternate_names?: unknown
    remote_ids?: { wikidata?: string }
    photos?: unknown
    birth_date?: string
    death_date?: string
    type?: { key?: string }
    location?: string
  } | null
  const key = authorKey(author?.key)
  if (!author || !key) return null
  const photos = Array.isArray(author.photos) ? author.photos.filter((p): p is number => typeof p === 'number' && p > 0) : []
  const wikidata = author.remote_ids?.wikidata
  return {
    key,
    name: (author.name ?? author.personal_name)?.trim() || null,
    alternateNames: strings(author.alternate_names),
    wikidata: typeof wikidata === 'string' && /^Q\d+$/.test(wikidata) ? wikidata : null,
    photoId: photos[0] ?? null,
    birth: author.birth_date?.trim() || null,
    death: author.death_date?.trim() || null,
  }
}

export function parseSeriesName(body: unknown): string | null {
  const name = (body as { name?: unknown } | null)?.name
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

export type OlSearchDoc = {
  key: string
  title: string | null
  authorKeys: string[]
  authorNames: string[]
  year: number | null
  coverId: number | null
  subjects: string[]
  editionCount: number
  edition: { key: string | null; title: string | null; isbn13: string | null; coverId: number | null; language: string | null } | null
}

export function parseSearch(body: unknown): OlSearchDoc[] {
  const docs = (body as { docs?: unknown[] } | null)?.docs
  if (!Array.isArray(docs)) return []
  return docs
    .map((raw): OlSearchDoc | null => {
      const doc = raw as Record<string, unknown>
      const key = workKey(doc.key)
      if (!key) return null
      const edition = ((doc.editions as { docs?: Record<string, unknown>[] } | undefined)?.docs ?? [])[0]
      return {
        key,
        title: typeof doc.title === 'string' ? doc.title.trim() : null,
        authorKeys: strings(doc.author_key).filter((k) => AUTHOR_KEY.test(k)),
        authorNames: strings(doc.author_name),
        year: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : null,
        coverId: typeof doc.cover_i === 'number' && doc.cover_i > 0 ? doc.cover_i : null,
        subjects: strings(doc.subject),
        editionCount: typeof doc.edition_count === 'number' ? doc.edition_count : 0,
        edition: edition
          ? {
              key: editionKey(edition.key),
              title: typeof edition.title === 'string' ? edition.title.trim() : null,
              isbn13: strings(edition.isbn).find((isbn) => /^97[89]\d{10}$/.test(isbn)) ?? null,
              coverId: typeof edition.cover_i === 'number' && edition.cover_i > 0 ? edition.cover_i : null,
              language: strings(edition.language)[0] ?? null,
            }
          : null,
      }
    })
    .filter((doc): doc is OlSearchDoc => doc !== null)
}

// ------------------------------------------------------------- series text

/**
 * Publishers' series an edition's `series` often names instead of the story's
 * ("Modern Library Classics", "Gollancz SF Masterworks", "Ventana abierta 6"):
 * not a series a reader reads in order.
 */
const PUBLISHER_SERIES =
  /\b(classics?|masterworks|library|bibliothe[ck]|collection|colecci[oó]n|collana|edition|editions|penguin|vintage|gollancz|signet|bantam|everyman|oxford|taschenbuch|heyne|goldmann|fischer|ventana|reclam|folio|pocket|paperbacks?|imprint)\b/i

/**
 * An edition's free-text series as a name and a position:
 * "Discworld ; 15", "Discworld #15", "The Expanse, book 1", "Book of the New
 * Sun (1)", "Discworld (13)", "Harry Potter Bd. 4", "Discworld series".
 * "A Discworld novel" names the series without a position. Null for text
 * that names no series at all.
 */
export function parseSeriesText(text: string): { name: string; position: number | null } | null {
  let value = text.replace(/\s+/g, ' ').trim()
  if (!value) return null
  let position: number | null = null
  const numbered = value.match(
    /^(.*?)[\s,;:#(\-–—]*(?:(?:book|vol(?:ume)?|no|nr|number|band|bd|part|tome|t)\.?\s*)?#?\s*(\d{1,4}(?:\.\d{1,2})?)\s*\)?\.?$/i,
  )
  if (numbered && numbered[1]!.trim()) {
    value = numbered[1]!.trim()
    position = Number(numbered[2])
  }
  value = value
    .replace(/^an? (.+?) novel$/i, '$1')
    .replace(/[\s,;:#(\-–—]+$/, '')
    .replace(/\s+(series|saga|sequence|cycle|trilogy|reihe)$/i, '')
    .trim()
  if (!value || /^\d+$/.test(value) || value.length > 200 || PUBLISHER_SERIES.test(value)) return null
  return { name: value, position }
}

function parsePosition(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(\d{1,4}(?:\.\d{1,2})?)$/)
  return match ? Number(match[1]) : null
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim())
}
