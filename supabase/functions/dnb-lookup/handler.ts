/**
 * `dnb-lookup`: German editions from the German National Library (DNB), for the barcode scan,
 * the ISBN lookups and the edition picker. CC0 data, no covers, no genres; the browser never
 * talks to the DNB (this function keeps its requests few, short and behind a breaker).
 *
 *   POST /functions/v1/dnb-lookup  { "action": "isbn",     "isbn13": "9783499267017" }
 *   POST /functions/v1/dnb-lookup  { "action": "editions", "title": "Der Schwarm", "authors": ["Frank Schätzing"] }
 *   POST /functions/v1/dnb-lookup  { "action": "book",     "isbn13": "9783499267017" }
 *
 *   200 { status: 'found', edition }      isbn: the edition (with an Open Library cover when there is one)
 *   200 { status: 'not_found' }           isbn, book: no record has it
 *   200 { status: 'ok', editions: [] }    editions: one per record with an ISBN-13, books only
 *   200 { status: 'found', book }         book: the Catalogue Book (made now if it was not there), a `books` row
 *   400 { error: 'isbn_invalid' | 'book_unidentified' | 'action_unknown' } · 401 { error: 'unauthorized' }
 *   413 { error: 'payload_too_large' } · 429 { error: 'rate_limited' } · 502 { error: 'dnb_unavailable' }
 *
 * `book` is what makes an edition the DNB alone knows addable: a member may only add a Catalogue
 * Book (an `import` snapshot that matches none is refused by the database), so the function
 * writes the Book as the service role, from what the DNB says about the ISBN (never from what
 * the caller sends). A failure is never stored. Everything it talks to comes in from outside
 * (index.ts wires the real ones), so the tests drive it with recordings.
 */
import { type DnbEdition, editionFromRecord, toIsbn13 } from '../../../web/app/data/dnbRecord.ts'
import { type Dnb, DnbUnavailable } from './client.ts'

/** The `books` row the function makes and returns (the columns the app reads: data/library.ts `BookRow`). */
export type BookRow = {
  id: string
  title: string
  authors: string[]
  isbn13: string | null
  isbn10: string | null
  page_count: number | null
  published_year: number | null
  language: string | null
  publisher: string | null
  description: string | null
  cover_url: string | null
  cover_thumbhash: string | null
  cover_dominant: string | null
  cover_secondary: string | null
  source: string
  apple_id: string | null
  openlibrary_edition_key: string | null
  openlibrary_work_key: string | null
  created_at: string
}

export type Catalogue = {
  /** The Catalogue Book of this ISBN-13, if there is one. */
  find: (isbn13: string) => Promise<BookRow | null>
  /** Makes it a Catalogue Book of source `import`, with the cover (its URL, thumbhash, colours); the existing one when another call was first. */
  insert: (edition: DnbEdition, cover: Cover | null) => Promise<BookRow>
}

/** A cover as the app resolved it (data/covers.ts): the image's URL, its thumbhash and its two colours. */
export type Cover = { coverUrl: string; coverThumbhash: string | null; dominant: string | null; secondary: string | null }

/** Where a cover may come from: the two hosts the app resolves covers from (Apple's CDN, Open Library). */
const COVER_URL = /^https:\/\/(?:is\d-ssl\.mzstatic\.com\/|covers\.openlibrary\.org\/)\S{1,400}$/
const HEX = /^#[0-9a-f]{6}$/

/** The cover a caller sent with `book`, or null when it is not one the Catalogue takes (anything else is left out, not refused). */
export function readCover(value: unknown): Cover | null {
  if (!value || typeof value !== 'object') return null
  const { coverUrl, coverThumbhash, coverColors } = value as { coverUrl?: unknown; coverThumbhash?: unknown; coverColors?: { dominant?: unknown; secondary?: unknown } | null }
  if (typeof coverUrl !== 'string' || !COVER_URL.test(coverUrl)) return null
  const hash = typeof coverThumbhash === 'string' && /^[A-Za-z0-9+/=]{1,200}$/.test(coverThumbhash) ? coverThumbhash : null
  const dominant = typeof coverColors?.dominant === 'string' && HEX.test(coverColors.dominant) ? coverColors.dominant : null
  const secondary = typeof coverColors?.secondary === 'string' && HEX.test(coverColors.secondary) ? coverColors.secondary : null
  return { coverUrl, coverThumbhash: hash, dominant: dominant && secondary ? dominant : null, secondary: dominant && secondary ? secondary : null }
}

/** The member (or the service role, `member: null`) a request comes from. */
export type Caller = { member: string | null }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } })
}

/** Longest request body taken: an ISBN, or a title and a few names. */
export const MAX_BODY_BYTES = 4 * 1024
export const MAX_AUTHORS = 5
export const MAX_AUTHOR_CHARS = 200
export const MAX_TITLE_CHARS = 300
/** What a member may ask in a minute (the function's own upstream budget is five requests a second). */
export const MEMBER_LIMIT = 30
export const MEMBER_WINDOW_SECONDS = 60

type Body = { action?: unknown; isbn13?: unknown; isbn?: unknown; title?: unknown; authors?: unknown; cover?: unknown }

async function readBody(request: Request): Promise<Body | 'too_large' | 'invalid'> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return 'too_large'
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return 'too_large'
  try {
    const body = JSON.parse(text)
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Body) : 'invalid'
  } catch {
    return 'invalid'
  }
}

export function createHandler(deps: {
  dnb: Dnb
  catalogue: Catalogue
  /** The cover Open Library has for an ISBN-13 (its URL), or null; never rejects. */
  cover: (isbn13: string) => Promise<string | null>
  authorize: (request: Request) => Promise<Caller | null>
  /** Counts one call of a member; false when she is over her limit. Not asked for the service role. */
  throttle?: (member: string) => Promise<boolean>
  log?: (message: string) => void
}): (request: Request) => Promise<Response> {
  const log = deps.log ?? ((message) => console.error(message))

  /** The edition of an ISBN-13, or null; rejects with `DnbUnavailable`. */
  async function edition(isbn13: string): Promise<DnbEdition | null> {
    const records = await deps.dnb.byIsbn(isbn13)
    for (const record of records) {
      if (!record.isbn13s.includes(isbn13)) continue
      const found = editionFromRecord(record, isbn13)
      if (found) return found
    }
    return null
  }

  return async function handler(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const caller = await deps.authorize(request)
    if (!caller) return json(401, { error: 'unauthorized' })
    if (caller.member && deps.throttle) {
      let allowed: boolean
      try {
        allowed = await deps.throttle(caller.member)
      } catch (error) {
        log(`dnb-lookup: throttle failed: ${error}`)
        return json(502, { error: 'dnb_unavailable' })
      }
      if (!allowed) return json(429, { error: 'rate_limited' })
    }

    const body = await readBody(request)
    if (body === 'too_large') return json(413, { error: 'payload_too_large' })
    if (body === 'invalid') return json(400, { error: 'book_unidentified' })

    try {
      switch (body.action) {
        case 'isbn':
        case 'book': {
          const isbn13 = typeof (body.isbn13 ?? body.isbn) === 'string' ? toIsbn13(String(body.isbn13 ?? body.isbn)) : null
          if (!isbn13) return json(400, { error: 'isbn_invalid' })
          if (body.action === 'book') {
            const known = await deps.catalogue.find(isbn13)
            if (known) return json(200, { status: 'found', book: known })
          }
          const found = await edition(isbn13)
          if (!found) return json(200, { status: 'not_found' })
          if (body.action === 'isbn') return json(200, { status: 'found', edition: { ...found, coverUrl: await deps.cover(isbn13) } })
          // The cover the app resolved for it (the same trust as an add), else the one Open Library has.
          const sent = readCover(body.cover)
          const own = sent ?? (await deps.cover(isbn13).then((url) => (url ? { coverUrl: url, coverThumbhash: null, dominant: null, secondary: null } : null)))
          return json(200, { status: 'found', book: await deps.catalogue.insert(found, own) })
        }
        case 'editions': {
          const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE_CHARS) : ''
          const authors = Array.isArray(body.authors)
            ? body.authors.filter((a): a is string => typeof a === 'string' && Boolean(a.trim())).slice(0, MAX_AUTHORS).map((a) => a.trim().slice(0, MAX_AUTHOR_CHARS))
            : []
          if (!title) return json(400, { error: 'book_unidentified' })
          const records = await deps.dnb.byTitle(title, authors[0] ?? '')
          const seen = new Set<string>()
          const editions: DnbEdition[] = []
          for (const record of records) {
            const found = editionFromRecord(record)
            if (!found || seen.has(found.isbn13)) continue
            seen.add(found.isbn13)
            editions.push(found)
          }
          return json(200, { status: 'ok', editions })
        }
        default:
          return json(400, { error: 'action_unknown' })
      }
    } catch (error) {
      if (!(error instanceof DnbUnavailable)) log(`dnb-lookup: ${body.action} failed: ${error}`)
      return json(502, { error: 'dnb_unavailable' })
    }
  }
}
