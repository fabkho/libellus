import { isbn10To13, isValidIsbn10, isValidIsbn13 } from '../data/books'

/**
 * What the Android share sheet hands Libellus (issue #91): the manifest's GET
 * `share_target` passes `title`, `text` and `url` as query parameters. Apps
 * fill them as they please: Chrome puts the link in `text` (and the page title
 * in `title`), Goodreads and Amazon share a sentence with the link inside it,
 * a bookstore app may share only a title or an ISBN. This reads whatever
 * arrived into the one thing the app can act on. Pure: no Vue, no network.
 */
export type SharedPayload = {
  title?: string | null
  text?: string | null
  url?: string | null
  /** EPUB files shared to the app (issue #131): the id the service worker kept them under (public/sw-share.js). */
  ebooks?: string | null
}

export type SharedBook = {
  /** A valid ISBN-13 found in a link or in the text (an ISBN-10 is converted), else null. */
  isbn13: string | null
  /** The id of a Goodreads book link (`/book/show/<id>`), else null. */
  goodreadsId: string | null
  /** What to search for when no ISBN leads to the Book: the shared title text, cleaned of links and boilerplate. */
  query: string
  /** The title alone ("Piranesi" from "Piranesi by Susanna Clarke"), to tell a confident hit from a guess; '' when unknown. */
  titleHint: string
}

const LINK = /https?:\/\/[^\s<>"“”]+/gi
// Where a sentence ends a link: "…/dp/0123456789)." is the link without ")."
const LINK_TAIL = /[)\].,;:!?'’”]+$/

/** The links inside a piece of text, without the punctuation that ends the sentence. */
export function linksIn(text: string): string[] {
  return (text.match(LINK) ?? []).map((link) => link.replace(LINK_TAIL, ''))
}

function parsedUrl(link: string): URL | null {
  try {
    return new URL(link)
  } catch {
    return null
  }
}

const isAmazon = (host: string) => /(^|\.)amazon\.[a-z.]+$/i.test(host) || /^(amzn\.[a-z]+|a\.co)$/i.test(host)
const isGoodreads = (host: string) => /(^|\.)goodreads\.com$/i.test(host)

/** ISBN-10 → ISBN-13 when `value` (hyphens allowed) is a valid ISBN-10, else null. */
function fromIsbn10(value: string): string | null {
  const compact = value.replace(/-/g, '').toUpperCase()
  return isValidIsbn10(compact) ? isbn10To13(compact) : null
}

function fromIsbn13(value: string): string | null {
  const compact = value.replace(/-/g, '')
  return isValidIsbn13(compact) ? compact : null
}

/** Amazon's product addresses carry the ISBN-10 as the ASIN (`B0…` ASINs are not books' ISBNs and fail the check). */
const AMAZON_PRODUCT = /\/(?:dp|gp\/product|gp\/aw\/d|gp\/offer-listing|exec\/obidos\/ASIN|product)\/([0-9A-Z]{10})(?![0-9A-Z])/i

function amazonIsbn(url: URL): string | null {
  const match = AMAZON_PRODUCT.exec(url.pathname)
  if (!match) return null
  const asin = match[1]!.toUpperCase()
  return fromIsbn10(asin) ?? null
}

const ISBN_PARAMS = /^(isbn|isbn10|isbn13|isbn-10|isbn-13|ean|gtin|gtin13|upc)$/i

/** The address's own ISBN: an `isbn=` style parameter. */
function paramIsbn(url: URL): string | null {
  for (const [name, value] of url.searchParams) {
    if (!ISBN_PARAMS.test(name)) continue
    const compact = value.replace(/[\s-]/g, '')
    const found = fromIsbn13(compact) ?? fromIsbn10(compact)
    if (found) return found
  }
  return null
}

// A run of digits and hyphens, 10 or 13 digits long once the hyphens are gone, standing on its own.
const NUMBER = /(?<![\w-])(\d[\d-]{8,15}[\dXx])(?![\w-])/g

/**
 * ISBNs inside free text or an address, in order of appearance. An ISBN-13 only
 * needs its checksum. An ISBN-10 is a short number any ten digits can spell
 * (one in eleven passes the check), so it also needs a sign that it is one: a
 * hyphen, an "ISBN" label just before, or (in an address) standing alone as a
 * path segment or a parameter's value.
 */
function numbersIn(source: string, { address }: { address: boolean }): string[] {
  const found: string[] = []
  for (const match of source.matchAll(NUMBER)) {
    const token = match[1]!
    const compact = token.replace(/-/g, '')
    if (compact.length === 13) {
      const isbn = fromIsbn13(compact)
      if (isbn) found.push(isbn)
    } else if (compact.length === 10) {
      const start = match.index
      const before = source.slice(Math.max(0, start - 14), start)
      const labelled = /isbn(?:[-\s]?10)?[^\d]{0,6}$/i.test(before)
      const alone = address && /[/=]$/.test(before) && /^(?:[/?&#.]|$)/.test(source.slice(start + token.length))
      if (token.includes('-') || labelled || alone) {
        const isbn = fromIsbn10(compact)
        if (isbn) found.push(isbn)
      }
    }
  }
  return found
}

/** A Goodreads book link: `/book/show/40180098-piranesi` → its id and the slug's words. */
function goodreadsBook(url: URL): { id: string; slug: string } | null {
  if (!isGoodreads(url.hostname)) return null
  const match = /\/book\/show\/(\d+)(?:[.-]([^/?#]+))?/.exec(url.pathname)
  if (!match) return null
  return { id: match[1]!, slug: (match[2] ?? '').replace(/[-_]+/g, ' ').trim() }
}

// The words around a title that the sharing app added.
const LEAD = /^(?:(?:check out|have a look at|take a look at|look at)\s+)+/i
const TRAIL = [
  /\s*[|\-–—:]\s*goodreads\b.*$/i,
  /\s+on\s+goodreads\b.*$/i,
  /\s*\(goodreads\)\s*$/i,
  /\s*[|\-–—:]\s*amazon\.[a-z.]+.*$/i,
  /\s*[|\-–—:]\s*(?:buy|kaufen)\b.*$/i,
  /\s+(?:on|at|bei|von)\s+amazon(?:\.[a-z.]+)?\s*$/i,
  /:\s*books?\s*$/i,
]

/** A shared sentence or page title as the words to search for: no links, no ISBNs, no "on Goodreads". */
export function cleanSharedText(text: string): string {
  let clean = text.replace(LINK, ' ')
  // "Amazon.com: Piranesi: 9781635575637: Clarke, Susanna: Books" → "Piranesi: Clarke, Susanna"
  clean = clean.replace(/^\s*amazon\.[a-z.]+\s*:\s*/i, '')
  clean = clean.replace(NUMBER, (token) => ([10, 13].includes(token.replace(/-/g, '').length) ? ' ' : token))
  clean = clean.replace(/(?::\s*){2,}/g, ': ')
  clean = clean.replace(/[“”"«»]/g, ' ').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3; i++) {
    const before = clean
    clean = clean.replace(LEAD, '')
    for (const trail of TRAIL) clean = clean.replace(trail, '')
    clean = clean.replace(/[\s:|,;–—-]+$/g, '').replace(/^[\s:|,;–—-]+/g, '').trim()
    if (clean === before) break
  }
  return clean
}

/** "Piranesi by Susanna Clarke" → the title and the search words ("Piranesi Susanna Clarke": a search matches words, and "by" is none of the book's). */
function splitByAuthor(clean: string): { title: string; query: string } {
  const at = clean.toLowerCase().lastIndexOf(' by ')
  if (at <= 0) return { title: clean, query: clean }
  const title = clean.slice(0, at).trim()
  const author = clean.slice(at + 4).trim()
  return { title, query: author ? `${title} ${author}` : title }
}

/**
 * Reads a share. The ISBN wins wherever it stands: an Amazon product address
 * (`/dp/<ISBN-10>`, `/gp/product/<ISBN-10>`), an `isbn=` parameter, any
 * ISBN-13 or hyphenated ISBN-10 in a link or in the text, always with its
 * check digit validated. Failing that, a Goodreads book link gives its id (the
 * Goodreads cache may know the ISBN) and the words to search; anything else is
 * the shared text searched as a title.
 */
export function parseShared(payload: SharedPayload): SharedBook {
  const url = payload.url?.trim() ?? ''
  const text = payload.text?.trim() ?? ''
  const title = payload.title?.trim() ?? ''

  const links = [...(url ? [url] : []), ...linksIn(text), ...linksIn(title)]
  // A `url` that is no address (some apps share a title there) is text like the rest.
  const addresses = links.map(parsedUrl).filter((address): address is URL => address !== null)
  const sources = [text, title, ...(url && !parsedUrl(url) ? [url] : [])]

  let isbn13: string | null = null
  for (const address of addresses) {
    isbn13 = (isAmazon(address.hostname) ? amazonIsbn(address) : null) ?? paramIsbn(address)
    if (isbn13) break
  }
  if (!isbn13) {
    const candidates = [
      ...addresses.flatMap((address) => numbersIn(safeDecode(address.pathname + address.search), { address: true })),
      ...sources.flatMap((source) => numbersIn(source.replace(LINK, ' '), { address: false })),
    ]
    isbn13 = candidates[0] ?? null
  }

  let goodreads: { id: string; slug: string } | null = null
  for (const address of addresses) {
    goodreads = goodreadsBook(address)
    if (goodreads) break
  }

  // The sentence she shared says most; the page title is what a browser sends.
  const words = [text, title, url && !parsedUrl(url) ? url : ''].map(cleanSharedText).find((clean) => clean.length > 0) ?? ''
  const split = splitByAuthor(words || goodreads?.slug || '')
  const query = split.query || (isbn13 ?? '')
  return { isbn13, goodreadsId: goodreads?.id ?? null, query, titleHint: split.title }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Whether a found Book is the one the share named, by its title alone: the same
 * words, or the same words before a subtitle ("Piranesi" for "Piranesi: A
 * Novel"). A share that names only a title never counts (editions and namesakes
 * are the member's pick); a Goodreads share names a Book, so a hit that bears
 * its title is taken.
 */
export function namesTheBook(titleHint: string, bookTitle: string): boolean {
  const wanted = fold(titleHint)
  if (!wanted) return false
  const found = fold(bookTitle)
  if (found === wanted) return true
  const main = fold(bookTitle.split(/[:(]/)[0] ?? '')
  return main === wanted
}
