/**
 * What the check asks a Book's source and what it believes of the answer (social v2a contract §5).
 * Pure but for the `Http` it is given: Apple's iTunes lookup by track id (many at once, per
 * storefront), Open Library's edition (`/books/<key>.json`, `/isbn/<isbn>.json`) and work
 * (`/works/<key>.json`) records, and the names of the authors they list (`/authors/<key>.json`).
 *
 * Every field that leaves here was checked for type and length and rebuilt: the title, the authors
 * and the description are plain text (tags dropped, entities decoded, capped); the cover is an
 * https URL on Apple's CDN (`*.mzstatic.com`, at the stored size) or Open Library's covers
 * (`covers.openlibrary.org/b/id/<n>-L.jpg`): the hosts the app's cover rules accept
 * (web/app/data/covers.ts) and the database lets others see (private.cover_shown). Anything else is
 * left out, and the Book keeps what it has. The database validates again (catalogue_check_save).
 *
 * A source that does not know a Book is `unknown`; a source that failed (down, slow, garbled) is
 * `unavailable` and never a miss.
 */
import { decodeEntities } from '../../../web/app/data/entities.ts'
import { type Http, SourceUnavailable } from '../enrich/http.ts'

export const ITUNES = 'https://itunes.apple.com'
export const OPENLIBRARY = 'https://openlibrary.org'
/** The storefronts asked, in order: a Book sold in none of them is unknown to Apple. */
export const STOREFRONTS = ['us', 'de', 'gb'] as const
/** At most this many track ids one lookup asks for. */
export const LOOKUP_BATCH = 50
export const MAX_AUTHORS = 20
export const MAX_AUTHOR_NAMES_FETCHED = 3
export const MAX_TITLE = 500
export const MAX_NAME = 200
export const MAX_DESCRIPTION = 10_000

/** The columns of a claimed Book the check reads. */
export type CheckBook = {
  id: string
  source?: string | null
  apple_id: string | null
  isbn13: string | null
  isbn10: string | null
  openlibrary_edition_key: string | null
  openlibrary_work_key: string | null
}

/** What is written for a Book (the arguments of catalogue_check_save). */
export type CheckResult = {
  title?: string
  authors?: string[]
  /** The source's description; null when it has none (the first member's is then dropped). */
  description: string | null
  cover_url?: string
}

export type Outcome =
  | { status: 'found'; result: CheckResult }
  | { status: 'unknown' }
  | { status: 'unavailable'; error: string }

// ------------------------------------------------------------------ keys

const APPLE_ID = /^\d{1,20}$/
const ISBN13 = /^97[89]\d{10}$/
const ISBN10 = /^\d{9}[\dX]$/
const EDITION_KEY = /(OL\d{1,12}M)$/
const WORK_KEY = /(OL\d{1,12}W)$/
const AUTHOR_KEY = /(OL\d{1,12}A)$/

/** A stored key if it is shaped like one; keys come from members, so they are checked before they join a URL. */
export function keyOf(value: string | null | undefined, shape: RegExp): string | null {
  const match = shape.exec((value ?? '').trim())
  return match ? (match[1] ?? match[0]) : null
}

// ------------------------------------------------------------------ text

/** Markup as plain text: paragraphs kept, tags dropped, entities decoded. (data/apple.ts's plainText.) */
export function plainText(html: unknown): string | null {
  if (typeof html !== 'string' || !html) return null
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|h\d)>/gi, '\n\n')
      .replace(/<[^>]*>/g, ''),
  )
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text || null
}

export function description(value: unknown): string | null {
  // Open Library: a string, or {type: '/type/text', value}.
  const raw = typeof value === 'object' && value !== null ? (value as { value?: unknown }).value : value
  const text = plainText(raw)
  return text ? text.slice(0, MAX_DESCRIPTION).trim() : null
}

/** Library-catalogue punctuation at the end of a title ("Piranesi.", "Emma /") goes. (data/openLibrary.ts.) */
export function title(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = decodeEntities(value).replace(/\s+/g, ' ').replace(/[\s/:;,.]+$/, '').trim()
  return text && text.length <= MAX_TITLE ? text : undefined
}

export function names(values: unknown[]): string[] | undefined {
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const name = decodeEntities(value).replace(/\s+/g, ' ').trim()
    if (name && name.length <= MAX_NAME && !out.includes(name)) out.push(name)
  }
  return out.length && out.length <= MAX_AUTHORS ? out : undefined
}

const NAME_SUFFIX = /^(?:Jr\.?|Sr\.?|II|III|IV|PhD)$/i

/** "A, B & C" → three authors, in order. (data/apple.ts's splitAuthors.) */
export function splitAuthors(artistName: unknown): string[] {
  if (typeof artistName !== 'string') return []
  const authors: string[] = []
  for (const part of decodeEntities(artistName).split(/\s*,\s*|\s+&\s+/).map((p) => p.trim()).filter(Boolean)) {
    if (NAME_SUFFIX.test(part) && authors.length) authors[authors.length - 1] += `, ${part}`
    else authors.push(part)
  }
  return authors
}

// ----------------------------------------------------------------- covers

const ARTWORK_SIZE = /\/\d+x\d+bb\.(?:jpg|jpeg|png|webp)$/

/** Apple's artwork at the size a Catalogue cover is stored at (600 × 900); null for any other host or shape. */
export function appleCover(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 500) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
  if (!/^([a-z0-9-]+\.)+mzstatic\.com$/.test(url.hostname) || url.pathname.length < 2) return undefined
  const href = ARTWORK_SIZE.test(url.pathname) ? url.href.replace(ARTWORK_SIZE, '/600x900bb.jpg') : url.href
  return /\s/.test(href) ? undefined : href
}

/** Open Library's cover by its id; ids of 0 or less ("no cover") are none. */
export function openLibraryCover(covers: unknown): string | undefined {
  if (!Array.isArray(covers)) return undefined
  const id = covers.find((c) => Number.isInteger(c) && c > 0 && c < 1e12)
  return id ? `https://covers.openlibrary.org/b/id/${id}-L.jpg` : undefined
}

// ------------------------------------------------------------------ Apple

type AppleItem = Record<string, unknown>

export function lookupUrl(ids: readonly string[], country: string): string {
  return `${ITUNES}/lookup?${new URLSearchParams({ id: [...ids].sort().join(','), country })}`
}

function fromApple(item: AppleItem): CheckResult | null {
  const heading = title(item.trackName)
  if (!heading) return null
  const authors = names(splitAuthors(item.artistName))
  const cover = appleCover(item.artworkUrl100 ?? item.artworkUrl60)
  return {
    title: heading,
    ...(authors ? { authors } : {}),
    description: description(item.description),
    ...(cover ? { cover_url: cover } : {}),
  }
}

/**
 * Apple's answer for each track id: one lookup per storefront for every id not yet found. An id no
 * storefront knows is `unknown`, unless a storefront failed on the way (then `unavailable`).
 */
export async function lookupApple(http: Http, ids: readonly string[]): Promise<Map<string, Outcome>> {
  const outcomes = new Map<string, Outcome>()
  let open = [...new Set(ids.filter((id) => APPLE_ID.test(id)))]
  let failure: string | null = null
  for (const country of STOREFRONTS) {
    if (!open.length) break
    const missing: string[] = []
    for (let i = 0; i < open.length; i += LOOKUP_BATCH) {
      const batch = open.slice(i, i + LOOKUP_BATCH)
      let body: { results?: unknown } | null
      try {
        body = await http.json<{ results?: unknown }>(lookupUrl(batch, country))
      } catch (error) {
        if (!(error instanceof SourceUnavailable)) throw error
        failure = error.message
        missing.push(...batch)
        continue
      }
      const results = Array.isArray(body?.results) ? (body!.results as AppleItem[]) : []
      const byId = new Map<string, AppleItem>()
      for (const item of results) {
        if (item && typeof item === 'object' && (item.trackId !== undefined) && (!item.kind || item.kind === 'ebook')) {
          byId.set(String(item.trackId), item)
        }
      }
      for (const id of batch) {
        const result = byId.has(id) ? fromApple(byId.get(id)!) : null
        if (result) outcomes.set(id, { status: 'found', result })
        else missing.push(id)
      }
    }
    open = missing
  }
  for (const id of open) outcomes.set(id, failure ? { status: 'unavailable', error: failure } : { status: 'unknown' })
  return outcomes
}

// ------------------------------------------------------------ Open Library

type OlRecord = Record<string, unknown>

function record(value: unknown): OlRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as OlRecord) : null
}

function firstKey(list: unknown, shape: RegExp, via?: string): string | null {
  if (!Array.isArray(list)) return null
  for (const entry of list) {
    const holder = via ? record(record(entry)?.[via]) : record(entry)
    const key = keyOf(typeof holder?.key === 'string' ? holder.key : null, shape)
    if (key) return key
  }
  return null
}

async function authorNames(http: Http, list: unknown, via?: string): Promise<string[] | undefined> {
  if (!Array.isArray(list)) return undefined
  const found: string[] = []
  for (const entry of list.slice(0, MAX_AUTHOR_NAMES_FETCHED)) {
    const holder = via ? record(record(entry)?.[via]) : record(entry)
    const key = keyOf(typeof holder?.key === 'string' ? holder.key : null, AUTHOR_KEY)
    if (!key) continue
    const author = record(await http.json(`${OPENLIBRARY}/authors/${key}.json`))
    if (typeof author?.name === 'string') found.push(author.name)
  }
  return names(found)
}

/**
 * The Book at Open Library: the edition by its key, else by ISBN, else its work. A key the source
 * does not know falls through to the next; a source that fails is `unavailable` unless a later one
 * answers.
 */
export async function lookupOpenLibrary(http: Http, book: CheckBook): Promise<Outcome> {
  const candidates: { url: string; kind: 'edition' | 'work' }[] = []
  const edition = keyOf(book.openlibrary_edition_key, EDITION_KEY)
  if (edition) candidates.push({ url: `${OPENLIBRARY}/books/${edition}.json`, kind: 'edition' })
  for (const isbn of [book.isbn13, book.isbn10]) {
    const clean = (isbn ?? '').trim()
    if (ISBN13.test(clean) || ISBN10.test(clean)) candidates.push({ url: `${OPENLIBRARY}/isbn/${clean}.json`, kind: 'edition' })
  }
  const work = keyOf(book.openlibrary_work_key, WORK_KEY)
  if (work) candidates.push({ url: `${OPENLIBRARY}/works/${work}.json`, kind: 'work' })

  let failure: string | null = null
  for (const candidate of candidates) {
    try {
      const found = record(await http.json(candidate.url))
      if (!found) continue
      const result = await fromOpenLibrary(http, found, candidate.kind)
      // A record that does not even name the Book is no answer.
      if (!result.title) continue
      return { status: 'found', result }
    } catch (error) {
      if (!(error instanceof SourceUnavailable)) throw error
      failure = error.message
    }
  }
  return failure ? { status: 'unavailable', error: failure } : { status: 'unknown' }
}

async function fromOpenLibrary(http: Http, found: OlRecord, kind: 'edition' | 'work'): Promise<CheckResult> {
  // An edition's blurb and cover are often the work's: ask it too when the edition lacks them.
  let work: OlRecord | null = kind === 'work' ? found : null
  if (kind === 'edition' && (!found.description || !found.covers)) {
    const workKey = firstKey(found.works, WORK_KEY)
    if (workKey) work = record(await http.json(`${OPENLIBRARY}/works/${workKey}.json`))
  }
  const heading = title(found.title)
  const authors = kind === 'edition'
    ? (await authorNames(http, found.authors)) ?? (work ? await authorNames(http, work.authors, 'author') : undefined)
    : await authorNames(http, found.authors, 'author')
  const cover = openLibraryCover(found.covers) ?? openLibraryCover(work?.covers)
  return {
    ...(heading ? { title: heading } : {}),
    ...(authors ? { authors } : {}),
    description: description(found.description) ?? description(work?.description),
    ...(cover ? { cover_url: cover } : {}),
  }
}
