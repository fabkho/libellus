/**
 * The German National Library's catalogue (Deutsche Nationalbibliothek, DNB) read as editions.
 * Its bibliographic data is open (CC0: no attribution, no storing limit); it has no covers and no
 * real genres, so it only says which edition a German ISBN or title is: title, authors, ISBN-13,
 * publisher, year, language, pages. Asked server-side by the `dnb-lookup` edge function
 * (supabase/functions/dnb-lookup), which imports this file: no imports of its own, so Deno, Node
 * and the browser read it alike. Pure; the tests answer from recordings.
 */

/** The SRU interface (CQL), answering the flat `oai_dc` record. */
export const DNB_SRU = 'https://services.dnb.de/sru/dnb'

/** Records one title search brings (a title can have dozens of editions; the SRU takes up to 100). */
export const DNB_LIMIT = 30

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

/** One edition, as the edge function answers it and the app reads it. */
export type DnbEdition = {
  title: string
  authors: string[]
  isbn13: string
  publisher: string | null
  year: number | null
  /** As the DNB writes it (`ger`, `eng`, `fre`): the MARC code. */
  language: string | null
  pages: number | null
  /** A cover the lookup found for the ISBN (Open Library), when it checked: the DNB has none. */
  coverUrl?: string | null
}

// -------------------------------------------------------------------- ISBN

const isbn13Sum = (digits: string) => [...digits].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)

/** True for 13 digits starting 978/979 whose check digit adds up. */
export function isValidIsbn13(value: string): boolean {
  return /^97[89]\d{10}$/.test(value) && isbn13Sum(value) % 10 === 0
}

function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false
  return [...value].reduce((total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index), 0) % 11 === 0
}

/** An ISBN as typed or printed (hyphens, spaces, an ISBN-10) → its ISBN-13; null when it is not a valid one. */
export function toIsbn13(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '').toUpperCase()
  if (isValidIsbn13(compact)) return compact
  if (!isValidIsbn10(compact)) return null
  const body = `978${compact.slice(0, 9)}`
  return `${body}${(10 - (isbn13Sum(`${body}0`) % 10)) % 10}`
}

// ------------------------------------------------------------------ reading

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

/** What the source answers when it cannot answer: an SRU diagnostic (its converter fails now and then, with HTTP 200). */
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
      .map((text) => toIsbn13(text))
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
 * leads the title (`Knightstone Academy 1 : Begehre uns nicht`, `Die Tribute von Panem 1. Tödliche
 * Spiele`, `Grischa, Band 3: Lodernde Schwingen`) gives way to the title after it.
 */
export function dnbTitle(raw: string): string {
  const main = raw.replace(/^\[[^\]]*\]\s*;\s*/, '').split(' / ')[0]!.trim()
  const numbered = /^.+?(?:,\s*(?:Band|Bd\.?|Teil|Buch)\s*\d+\s*[:.]|\s\d{1,3}\.)\s+(\S.*)$/i.exec(main)
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

/** Readings, radio plays and the like that the catalogue files with the books: no edition of a book. */
const AUDIO = /h[öo]e?rbuch|h[öo]e?rspiel|lesung|gelesen|\baudio|\bmp3\b|\bcd\b|ungekürzt/i

/** The record as an edition; null for an audio record or one without an ISBN-13 (`isbn13` picks which of its ISBNs). */
export function editionFromRecord(record: DnbRecord, isbn13: string | null = record.isbn13s[0] ?? null): DnbEdition | null {
  if (!isbn13 || AUDIO.test(record.rawTitle)) return null
  const title = dnbTitle(record.rawTitle)
  if (!title) return null
  return {
    title: title.slice(0, 500),
    authors: dnbAuthors(record.creators),
    isbn13,
    publisher: dnbPublisher(record.publisher),
    year: record.year && record.year >= 1 && record.year <= 2100 ? record.year : null,
    language: record.language?.toLowerCase() || null,
    pages: record.pages && record.pages > 0 ? record.pages : null,
  }
}

// ------------------------------------------------------------------ asking

/** Words of a title or a name that are safe inside a CQL phrase. */
const cql = (text: string) => text.replace(/[\\"()*?<>=/]/g, ' ').replace(/\s+/g, ' ').trim()

/** Printed and online books (`bbg` Aa…, Oa…), no audio, music or periodicals. */
const BOOKS = '(bbg=Aa* or bbg=Oa*)'

/** The CQL for one ISBN-13. */
export const isbnQuery = (isbn13: string) => `num=${cql(isbn13)}`

/** The CQL for a title and the first author's surname; null when the title is too short to ask with. */
export function titleQuery(title: string, author: string): string | null {
  const words = cql(title)
  if (words.length < 2) return null
  const surname = cql(author).split(' ').at(-1) ?? ''
  return [`tit="${words}"`, surname ? `per="${surname}"` : '', BOOKS].filter(Boolean).join(' and ')
}

/** The URL of a search. */
export function sruUrl(query: string, limit: number): string {
  const params = new URLSearchParams({ version: '1.1', operation: 'searchRetrieve', query, recordSchema: 'oai_dc', maximumRecords: String(limit) })
  return `${DNB_SRU}?${params}`
}
