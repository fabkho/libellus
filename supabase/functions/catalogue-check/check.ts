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
 * A Book is resolved by its STRONGEST key, in this order: ISBN-13 (an ISBN-10 as its ISBN-13), Apple id,
 * Open Library edition key, work key; never a weaker one when the stronger is unknown. Missing is not
 * contradicting: Open Library editions list only some ISBNs and sit in other works than the one stored,
 * Apple has several editions per ISBN, ISBN-10s differ: none of that is a mismatch, the source's data is
 * written and the row's keys stay. Only a positive contradiction is a `mismatch`: the source's record for
 * the key asked has another TITLE than the row (the edition's, with its subtitle, or its work's; accents,
 * brackets, a subtitle and a leading article ignored). That is a member's planted row (a real ISBN under
 * another Book's name): nothing is written, the Book is marked failed and its keys are cleared.
 *
 * A source that does not know a Book is `unknown`; a source that failed (down, slow, garbled) is
 * `unavailable` and never a miss.
 */
import { decodeEntities } from '../../../web/app/data/entities.ts'
import { normalize, workTitle } from '../../../web/app/data/import/readingTracker.ts'
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
export const MAX_PUBLISHER = 200
export const MAX_PAGES = 10_000

/** The columns of a claimed Book the check reads. */
export type CheckBook = {
  id: string
  /** What the first member sent; it must be the source's title (by `titleKey`) for the check to write anything. */
  title: string
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
  /** The source's, or null: a verified Book keeps none of the first member's (catalogue_check_save). */
  publisher: string | null
  language: string | null
  format: 'hardcover' | 'paperback' | 'ebook' | 'audiobook' | null
  /** The source's, or null when it has none (the row's own is then kept only if plausible). */
  page_count: number | null
  published_year: number | null
}

export type Outcome =
  | { status: 'found'; result: CheckResult }
  | { status: 'unknown' }
  /** The source answered, and the row's keys or title disagree with the answer: failed, nothing written. */
  | { status: 'mismatch'; reason: string }
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

/** The first year (1000–2099) a date text names. */
function yearOf(value: unknown): number | null {
  const match = typeof value === 'string' ? /\b(1\d{3}|20\d{2})\b/.exec(value) : null
  return match ? Number(match[1]) : null
}

/** Open Library's free-text `physical_format` as one of the four formats; null for anything else. (data/openLibrary.ts.) */
export function formatFromPhysical(physical: unknown): CheckResult['format'] {
  const text = (typeof physical === 'string' ? physical : '').trim().toLowerCase()
  if (!text) return null
  if (/audio|mp3|cassette|hörbuch|livre audio/.test(text)) return 'audiobook'
  if (/e-?book|electronic|kindle|epub|digital|e-text/.test(text)) return 'ebook'
  if (/hard ?(cover|back|bound)|library binding|gebunden|cartonn|relié|cartoné|tapa dura|rilegato/.test(text)) return 'hardcover'
  if (/paper ?back|soft ?(cover|back)|mass market|trade|pocket|taschenbuch|broschiert|brossura|broché|tapa blanda|rústica|poche|kartoniert/.test(text))
    return 'paperback'
  return null
}

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
    // Apple's ebook records say none of publisher, language or pages.
    publisher: null,
    language: null,
    format: 'ebook',
    page_count: null,
    published_year: yearOf(item.releaseDate),
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

// ---------------------------------------------------------------- identity

/** The key two titles are compared by: the app's `work_title_key` (brackets and the part after a colon dropped, accents and punctuation ignored). */
export function titleKey(value: string | null | undefined): string {
  return workTitle(value ?? '')
}

/** A leading article, in the languages the Catalogue's titles are in, ignored when titles are compared ("The Hobbit" = "Hobbit"). */
const ARTICLE = /^(?:the|a|an|der|die|das|ein|eine|le|la|les|l|un|une|el|los|las|il|lo|gli|het|een)\s+/

/**
 * Every form one title is compared in: the work key (brackets and subtitle dropped), the whole title, the part
 * before a dash, each with and without a leading article. Two titles are the same Book's when any form is shared.
 */
export function titleForms(value: string | null | undefined): Set<string> {
  const text = value ?? ''
  const forms = new Set<string>()
  for (const form of [text, text.split(/\s[-–—]\s/)[0] ?? '']) {
    for (const key of [workTitle(form), normalize(form)]) {
      if (!key) continue
      forms.add(key)
      forms.add(key.replace(ARTICLE, ''))
    }
  }
  forms.delete('')
  return forms
}

/** The first of `candidates` that is the stored title by any form (`titleForms`); null when none is. */
export function matchingTitle(stored: string, candidates: readonly (string | undefined)[]): string | null {
  const wanted = titleForms(stored)
  for (const candidate of candidates) {
    if (!candidate) continue
    for (const form of titleForms(candidate)) if (wanted.has(form)) return candidate
  }
  return null
}

/** ISBN-10 → ISBN-13 (978 prefix, new check digit). */
export function isbn10To13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/**
 * The keys a row stores that can be asked: a key that is not shaped like one is left out (it cannot be
 * asked; DB constraints hold the ISBNs and the Apple id to their shape), and the ISBN-10 is only a way
 * to an ISBN-13 when the row has none: it is bookkeeping, never a contradiction.
 */
type Keys = { isbn13: string | null; apple: string | null; edition: string | null; work: string | null }

function keysOf(book: CheckBook): Keys {
  const text = (value: string | null | undefined) => (value ?? '').trim()
  const isbn13 = ISBN13.test(text(book.isbn13)) ? text(book.isbn13) : null
  const isbn10 = ISBN10.test(text(book.isbn10)) ? text(book.isbn10) : null
  return {
    isbn13: isbn13 ?? (isbn10 ? isbn10To13(isbn10) : null),
    apple: APPLE_ID.test(text(book.apple_id)) ? text(book.apple_id) : null,
    edition: text(book.openlibrary_edition_key) ? keyOf(book.openlibrary_edition_key, EDITION_KEY) : null,
    work: text(book.openlibrary_work_key) ? keyOf(book.openlibrary_work_key, WORK_KEY) : null,
  }
}

const mismatch = (reason: string): Outcome => ({ status: 'mismatch', reason })

/**
 * Apple's answer for the ISBN, per storefront. The record is the edition with the stored Apple id when
 * the ISBN has it, else one with the stored title, else the first: an ISBN often has several editions
 * with several ids, and which one a row names is bookkeeping. Only a title that is not the stored one is a
 * contradiction.
 */
async function viaAppleIsbn(http: Http, keys: Keys, stored: string): Promise<Outcome> {
  let failure: string | null = null
  let contradicted = false
  for (const country of STOREFRONTS) {
    let body: { results?: unknown } | null
    try {
      body = await http.json<{ results?: unknown }>(`${ITUNES}/lookup?${new URLSearchParams({ isbn: keys.isbn13!, country })}`)
    } catch (error) {
      if (!(error instanceof SourceUnavailable)) throw error
      failure = error.message
      continue
    }
    const items = (Array.isArray(body?.results) ? (body!.results as AppleItem[]) : []).filter(
      (item) => item && typeof item === 'object' && item.trackId !== undefined && (!item.kind || item.kind === 'ebook'),
    )
    if (!items.length) continue
    const named = (item: AppleItem) => matchingTitle(stored, [title(item.trackName)]) !== null
    const item = items.find((candidate) => keys.apple !== null && String(candidate.trackId) === keys.apple && named(candidate)) ?? items.find(named)
    if (!item) {
      contradicted = true
      continue
    }
    const result = fromApple(item)
    return result ? { status: 'found', result } : { status: 'unknown' }
  }
  if (contradicted) return mismatch('title')
  return failure ? { status: 'unavailable', error: failure } : { status: 'unknown' }
}

/** The ISBN-13 form of every ISBN an Open Library record lists. */
function isbn13sOf(found: OlRecord): Set<string> {
  const out = new Set<string>()
  for (const field of ['isbn_13', 'isbn_10']) {
    const list = found[field]
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      const isbn = typeof raw === 'string' ? raw.replace(/[\s-]/g, '').toUpperCase() : ''
      if (ISBN13.test(isbn)) out.add(isbn)
      else if (ISBN10.test(isbn)) out.add(isbn10To13(isbn))
    }
  }
  return out
}

/** The titles an Open Library edition (or work) record answers to: its title, with its subtitle, and its work's title. */
async function olTitles(http: Http, found: OlRecord, kind: 'edition' | 'work'): Promise<(string | undefined)[]> {
  const own = title(found.title)
  const subtitle = title(found.subtitle)
  const full = title(found.full_title)
  const titles = [own, own && subtitle ? `${own}: ${subtitle}` : undefined, full]
  // An edition's own title may be another language's or a reprint's: its work's is the Book's.
  if (kind === 'edition') {
    const workKey = firstKey(found.works, WORK_KEY)
    const work = workKey ? record(await http.json(`${OPENLIBRARY}/works/${workKey}.json`)) : null
    if (work) titles.push(title(work.title), title(work.subtitle))
  }
  return titles
}

/**
 * The Open Library record the strongest key names (the ISBN's edition, the edition, or the work), if it is
 * the stored Book: its title, subtitle or work's title is the stored one. Every other key the row stores
 * (another edition of the ISBN, the work it sits in, an ISBN the edition does not list) is bookkeeping: the
 * row is resolved by the strongest key, the source's data is written and the keys are kept.
 */
async function viaOpenLibrary(
  http: Http,
  stored: string,
  target: { url: string; kind: 'edition' | 'work' },
  also?: { isbn13: string; edition: string | null },
): Promise<Outcome> {
  let found = record(await http.json(target.url))
  if (!found) return { status: 'unknown' }
  // A record that does not even name the Book is no answer.
  if (!title(found.title)) return { status: 'unknown' }
  let named = matchingTitle(stored, await olTitles(http, found, target.kind))
  // Several editions share an ISBN and Open Library answers for one of them (a Turkish reprint of the ISBN-10 of
  // Memoirs of Hadrian): the edition the row names is the Book's, when it lists that ISBN itself and answers to the title.
  if (named === null && also?.edition) {
    const own = record(await http.json(`${OPENLIBRARY}/books/${also.edition}.json`))
    if (own && title(own.title) && isbn13sOf(own).has(also.isbn13)) {
      const ownNamed = matchingTitle(stored, await olTitles(http, own, 'edition'))
      if (ownNamed !== null) {
        found = own
        named = ownNamed
      }
    }
  }
  if (named === null) return mismatch('title')
  const result = await fromOpenLibrary(http, found, target.kind)
  // The title written is the source's own form of the Book's name (the work's, when the edition is another language's).
  return { status: 'found', result: { ...result, title: named } }
}

/**
 * The Book at its source, by its strongest key (ISBN-13, ISBN-10, Apple id, Open Library edition, work, in this
 * order), never falling to a weaker one. Missing is not contradicting: the only mismatch is a positive one, the
 * source's record having another title than the row (a real ISBN under another Book's name); then nothing is
 * written and the row's keys are cleared (catalogue_check_mismatch). A source that fails is `unavailable`, a
 * source that does not know the key `unknown`.
 * `apple`: Apple's answers for the Apple ids already asked in one request (`lookupApple`).
 */
export async function checkBook(http: Http, book: CheckBook, apple: Map<string, Outcome> = new Map()): Promise<Outcome> {
  const keys = keysOf(book)
  const stored = book.title
  try {
    if (keys.isbn13) {
      // A row with an Apple id is an Apple Book; one with Open Library keys, an Open Library Book.
      const order: ('apple' | 'openlibrary')[] = keys.apple
        ? ['apple']
        : keys.edition || keys.work
        ? ['openlibrary']
        : book.source === 'apple'
        ? ['apple', 'openlibrary']
        : ['openlibrary', 'apple']
      let failure: Outcome | null = null
      for (const source of order) {
        const outcome = source === 'apple'
          ? await viaAppleIsbn(http, keys, stored)
          : await viaOpenLibrary(http, stored, { url: `${OPENLIBRARY}/isbn/${keys.isbn13}.json`, kind: 'edition' }, { isbn13: keys.isbn13, edition: keys.edition })
        if (outcome.status === 'unavailable') failure = outcome
        else if (outcome.status !== 'unknown') return outcome
      }
      return failure ?? { status: 'unknown' }
    }
    if (keys.apple) {
      const outcome = apple.get(keys.apple) ?? (await lookupApple(http, [keys.apple])).get(keys.apple) ?? { status: 'unknown' as const }
      if (outcome.status !== 'found') return outcome
      const named = matchingTitle(stored, [outcome.result.title])
      return named === null ? mismatch('title') : outcome
    }
    if (keys.edition) return await viaOpenLibrary(http, stored, { url: `${OPENLIBRARY}/books/${keys.edition}.json`, kind: 'edition' })
    if (keys.work) return await viaOpenLibrary(http, stored, { url: `${OPENLIBRARY}/works/${keys.work}.json`, kind: 'work' })
    return { status: 'unknown' }
  } catch (error) {
    if (error instanceof SourceUnavailable) return { status: 'unavailable', error: error.message }
    throw error
  }
}

/** Whether the check asks Apple for this Book by its id alone (the one lookup a batch can share). */
export function appleIdOnly(book: CheckBook): string | null {
  const id = (book.apple_id ?? '').trim()
  const hasIsbn = Boolean((book.isbn13 ?? '').trim() || (book.isbn10 ?? '').trim())
  return APPLE_ID.test(id) && !hasIsbn ? id : null
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
  // The edition's own facts; a work has none of them.
  const edition = kind === 'edition'
  const pages = Number(found.number_of_pages)
  const paginated = Number(/\d+/.exec(typeof found.pagination === 'string' ? found.pagination : '')?.[0])
  const pageCount = [pages, paginated].find((n) => Number.isInteger(n) && n > 0 && n <= MAX_PAGES) ?? null
  const publishers = Array.isArray(found.publishers) ? found.publishers : []
  const publisher = typeof publishers[0] === 'string' ? decodeEntities(publishers[0]).replace(/\s+/g, ' ').trim() : ''
  const languageKey = record(Array.isArray(found.languages) ? found.languages[0] : null)?.key
  const language = /\/languages\/([a-z]{3})$/.exec(typeof languageKey === 'string' ? languageKey : '')?.[1] ?? null
  return {
    ...(heading ? { title: heading } : {}),
    ...(authors ? { authors } : {}),
    description: description(found.description) ?? description(work?.description),
    ...(cover ? { cover_url: cover } : {}),
    publisher: edition && publisher && publisher.length <= MAX_PUBLISHER ? publisher : null,
    language: edition ? language : null,
    format: edition ? formatFromPhysical(found.physical_format) : null,
    page_count: edition ? pageCount : null,
    published_year: edition ? yearOf(found.publish_date) : null,
  }
}
