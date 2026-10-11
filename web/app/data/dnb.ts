import { isbnParts, type BookSnapshot } from './books'
import { abortError, type FetchLike } from './fetching'

/**
 * The German National Library (Deutsche Nationalbibliothek) as a source for the
 * import (a trial, docs/ENRICHMENT.md): its catalogue is open data (CC0: no
 * attribution, no caching limit), answers cross-origin reads (`access-control-allow-origin: *`)
 * and knows the German book trade by ISBN, title and author. It has no covers and no real
 * genres, so it only finds the edition: title, authors, ISBN-13, publisher, year, language, pages.
 *
 * The SRU interface (`services.dnb.de/sru/dnb`, CQL) with the `oai_dc` record, read here with a
 * few patterns (the record is flat; no XML parser, so Node, the browser and Deno read it alike).
 * Pure apart from `fetch`, which comes in from outside; the tests answer from recordings.
 */

const SRU = 'https://services.dnb.de/sru/dnb'

/** Records one search brings (a title can have dozens of editions; the SRU takes up to 100). */
export const DNB_LIMIT = 30

/** After this many answers in a row that were errors the source rests for `DNB_REST_MS`. */
export const DNB_FAILURES = 3
export const DNB_REST_MS = 60_000

/** One bibliographic record, as the source states it. */
export type DnbRecord = {
  idn: string | null
  /** As stated: `Titel : Untertitel / Verfasser`. */
  rawTitle: string
  creators: string[]
  publisher: string | null
  year: number | null
  language: string | null
  pages: number | null
  isbn13s: string[]
  subjects: string[]
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)

/** The text of every `<dc:tag …>…</dc:tag>` in a record, entities decoded. */
function elements(record: string, tag: string): string[] {
  const found: string[] = []
  for (const match of record.matchAll(new RegExp(`<dc:${tag}\\b[^>]*>([\\s\\S]*?)</dc:${tag}>`, 'g'))) found.push(decode(match[1]!).trim())
  return found
}

/** What the source answers when it cannot answer: an SRU diagnostic (its converter fails now and then). */
export class DnbError extends Error {}

/** The records of a `searchRetrieve` answer. Throws `DnbError` for a diagnostic. */
export function parseDnb(xml: string): DnbRecord[] {
  if (/<(?:\w+:)?diagnostic\b/.test(xml)) throw new DnbError(decode(/<(?:\w+:)?message>([\s\S]*?)</.exec(xml)?.[1] ?? 'diagnostic').slice(0, 200))
  const records: DnbRecord[] = []
  for (const match of xml.matchAll(/<recordData>([\s\S]*?)<\/recordData>/g)) {
    const record = match[1]!
    const rawTitle = elements(record, 'title')[0]
    if (!rawTitle) continue
    const idn = /<dc:identifier[^>]*xsi:type="dnb:IDN"[^>]*>(\d+)</.exec(record)?.[1] ?? null
    const isbn13s = [...record.matchAll(/<dc:identifier\b([^>]*)>([\s\S]*?)<\/dc:identifier>/g)]
      .filter((identifier) => /xsi:type="tel:ISBN"/.test(identifier[1]!))
      .map((identifier) => /^[\dxX-]{10,17}/.exec(decode(identifier[2]!).trim())?.[0] ?? '')
      .map((text) => isbnParts(text)?.isbn13 ?? null)
      .filter((isbn): isbn is string => Boolean(isbn))
    const pages = /(\d{1,5})\s*(?:S\.|Seiten|Bl\.)/.exec(elements(record, 'format')[0] ?? '')?.[1]
    records.push({
      idn,
      rawTitle,
      creators: elements(record, 'creator'),
      publisher: elements(record, 'publisher')[0] ?? null,
      year: Number(/\b(\d{4})\b/.exec(elements(record, 'date')[0] ?? '')?.[1]) || null,
      language: elements(record, 'language')[0] ?? null,
      pages: pages ? Number(pages) : null,
      isbn13s: [...new Set(isbn13s)],
      subjects: elements(record, 'subject'),
    })
  }
  return records
}

/**
 * The title as a reader knows it: the statement of responsibility (` / Verfasser …`) and a
 * leading `[Verfasser] ; ` dropped, `Titel : Untertitel` → `Titel: Untertitel`; a series that
 * leads the title (`Knightstone Academy 1 : Begehre uns nicht`) gives way to the title after it.
 */
export function dnbTitle(raw: string): string {
  const main = raw.replace(/^\[[^\]]*\]\s*;\s*/, '').split(' / ')[0]!.trim()
  // "Die Tribute von Panem 1. Tödliche Spiele", "Grischa, Band 3: Lodernde Schwingen": the series gives way to the title.
  const numbered = /^.+?(?:,\s*(?:Band|Bd\.?|Teil|Buch)\s*\d+\s*[:.]|\s\d{1,3}\.)\s+(\S.*)$/i.exec(main) ?? /^.+?,\s*(?:Band|Bd\.?|Teil|Buch)\s*\d+\s*:\s*(\S.*)$/i.exec(main)
  if (numbered) return numbered[1]!.trim()
  const [first, ...rest] = main.split(/\s+:\s+/)
  const sub = rest.join(': ').trim()
  if (!sub) return first!.trim()
  // "Reihe 1 : Titel", "Reihe, Band 3 : Titel": the volume number marks the series.
  if (/(?:^|[\s,])(?:Band|Bd\.?|Teil|Vol\.?|Volume|Buch)?\s*\d+\s*$/i.test(first!)) return sub
  return `${first!.trim()}: ${sub}`
}

/** `Nachname, Vorname [Verfasser]` → `Vorname Nachname`; the authors first, translators, artists and readers left out. */
export function dnbAuthors(creators: readonly string[]): string[] {
  const parsed = creators.map((creator) => {
    const roles = [...creator.matchAll(/\[([^\]]+)\]/g)].map((role) => role[1]!.toLowerCase())
    const [family, given] = creator.replace(/\s*\[[^\]]*\]/g, '').split(',').map((part) => part.trim())
    return { name: given ? `${given} ${family}` : (family ?? ''), roles }
  })
  const wrote = parsed.filter((who) => who.roles.some((role) => role === 'verfasser' || role === 'autor' || role === 'verfasserin'))
  const others = parsed.filter((who) => !who.roles.some((role) => /übersetzer|künstler|mitwirkender|erzähler|sprecher|illustrator|musiker/.test(role)))
  return [...new Set((wrote.length ? wrote : others).map((who) => who.name).filter(Boolean))]
}

/** `Reinbek bei Hamburg : Rowohlt Polaris` → `Rowohlt Polaris`. */
const dnbPublisher = (text: string | null) => (text ? (text.split(/\s+:\s+/).pop() ?? text).trim() || null : null)

/**
 * The record as the snapshot an `import` Book is made from: only a record with an ISBN-13 is
 * one (the Catalogue keys an `import` Book by it); `isbn13` picks which of its ISBNs.
 */
export function snapshotFromDnb(record: DnbRecord, isbn13: string | null = record.isbn13s[0] ?? null): BookSnapshot | null {
  if (!isbn13) return null
  const authors = dnbAuthors(record.creators)
  return {
    title: dnbTitle(record.rawTitle),
    authors,
    isbn13,
    isbn10: null,
    pageCount: record.pages,
    year: record.year,
    language: record.language,
    publisher: dnbPublisher(record.publisher),
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'import',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** Words of a title or a name that are safe inside a CQL phrase. */
const cql = (text: string) => text.replace(/[\\"()*?<>=/]/g, ' ').replace(/\s+/g, ' ').trim()

/** Readings, radio plays and the like that the catalogue files with the books: no edition of a book. */
const AUDIO = /h[öo]e?rbuch|h[öo]e?rspiel|lesung|gelesen|\baudio|\bmp3\b|\bcd\b|ungekürzt/i

/** Printed and online books (`bbg` Aa…, Oa…), no audio, music or periodicals. */
const BOOKS = '(bbg=Aa* or bbg=Oa*)'

export type Dnb = {
  /** The edition with this ISBN-13, or null. Rejects when the source could not be asked. */
  lookupIsbn: (isbn13: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot | null>
  /** The books of a title and author, as snapshots with an ISBN-13 (one per record). Rejects when it could not be asked. */
  search: (title: string, author: string, options?: { signal?: AbortSignal }) => Promise<BookSnapshot[]>
}

/**
 * The source, with its own circuit breaker: its converter fails now and then with a diagnostic
 * (HTTP 200), which a status check does not see; after `DNB_FAILURES` such answers in a row it is
 * left alone for `DNB_REST_MS` and asking it rejects at once.
 */
export function createDnb(options: { fetch: FetchLike; now?: () => number }): Dnb {
  const now = options.now ?? Date.now
  let failures = 0
  let restUntil = 0

  async function ask(query: string, limit: number, signal?: AbortSignal): Promise<DnbRecord[]> {
    if (restUntil > now()) throw new DnbError('resting')
    const params = new URLSearchParams({ version: '1.1', operation: 'searchRetrieve', query, recordSchema: 'oai_dc', maximumRecords: String(limit) })
    try {
      const response = await options.fetch(`${SRU}?${params}`, { signal })
      if (!response.ok) throw new DnbError(`services.dnb.de answered ${response.status}`)
      if (!response.text) throw new DnbError('no text')
      const records = parseDnb(await response.text())
      failures = 0
      return records
    } catch (error) {
      if (signal?.aborted) throw abortError()
      if (++failures >= DNB_FAILURES) {
        restUntil = now() + DNB_REST_MS
        failures = 0
      }
      throw error
    }
  }

  return {
    async lookupIsbn(isbn13, { signal } = {}) {
      const records = await ask(`num=${cql(isbn13)}`, 5, signal)
      const record = records.find((found) => found.isbn13s.includes(isbn13))
      return record ? snapshotFromDnb(record, isbn13) : null
    },
    async search(title, author, { signal } = {}) {
      const words = cql(title)
      const surname = cql(author).split(' ').at(-1) ?? ''
      if (words.length < 2) return []
      const query = [`tit="${words}"`, surname ? `per="${surname}"` : '', BOOKS].filter(Boolean).join(' and ')
      const records = await ask(query, DNB_LIMIT, signal)
      return records
        .filter((record) => !AUDIO.test(record.rawTitle))
        .map((record) => snapshotFromDnb(record))
        .filter((book): book is BookSnapshot => Boolean(book))
    },
  }
}
