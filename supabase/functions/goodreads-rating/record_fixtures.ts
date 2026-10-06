/**
 * Records the Goodreads answers the tests replay (fixtures/*.json). Run once,
 * by hand, when the recordings need renewing; the tests never call Goodreads.
 *
 *   deno run --allow-net --allow-write=fixtures record_fixtures.ts
 *
 * (from supabase/functions/goodreads-rating). Two seconds between requests,
 * identified like the function.
 */
import { autoCompleteUrl, reviewCountsUrl } from './goodreads.ts'
import { bookPageUrl } from './edition.ts'
import { USER_AGENT } from './client.ts'

const RECORDINGS: Record<string, string> = {
  // Terry Pratchett, Small Gods (Harper ebook): known by its ISBN.
  'review-counts-small-gods': reviewCountsUrl('9780061803208'),
  // A valid ISBN-13 Goodreads keeps a stub for: a book id, no ratings.
  'review-counts-unrated': reviewCountsUrl('9790000000001'),
  // A valid ISBN-13 nobody published: the 404 miss.
  'review-counts-unknown': reviewCountsUrl('9798991234566'),
  // Dennis E. Taylor, We Are Legion (We Are Bob): the title search.
  'auto-complete-we-are-legion': autoCompleteUrl('We Are Legion Taylor'),
  // Neil Gaiman, The Sandman, Vol. 5: A Game of You — a volume in a series.
  'auto-complete-sandman': autoCompleteUrl('The Sandman, Vol. 5 Gaiman'),
  // Nothing by that name.
  'auto-complete-nothing': autoCompleteUrl('Qxzvbnm Wplkjhg Zzyzx'),
}

/** The book pages (issue #111), recorded trimmed: id by name. */
const BOOK_PAGES: Record<string, string> = {
  // Terry Pratchett, Small Gods, the Kindle edition a Goodreads export names
  // without an ISBN: ASIN, format, pages, publisher, language, both ISBNs.
  'book-page-small-gods': '6388978',
}

async function record(name: string, url: string, body: string, status: number, contentType: string | null) {
  const recording = { url, status, contentType, body }
  await Deno.writeTextFile(new URL(`./fixtures/${name}.json`, import.meta.url), `${JSON.stringify(recording, null, 2)}\n`)
  console.log(name, status, body.length)
  await new Promise((resolve) => setTimeout(resolve, 2000))
}

/**
 * A book page is 600 KB of markup the parser never looks at. Only the one
 * script it reads is kept, with an apolloState cut down to the edition that
 * was asked for, two of the page's other `Book:` entries (stubs the parser has
 * to walk past) and ROOT_QUERY's pointer at the edition — a fixture small
 * enough to read in a review.
 */
function trim(html: string, goodreadsId: string): string {
  const script = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!script) throw new Error(`no __NEXT_DATA__ in the page of ${goodreadsId}`)
  const data = JSON.parse(script[1]!)
  const state: Record<string, unknown> = data?.props?.pageProps?.apolloState ?? {}
  const root = (state.ROOT_QUERY ?? {}) as Record<string, unknown>
  const kept: Record<string, unknown> = {
    ROOT_QUERY: Object.fromEntries(
      Object.entries(root).filter(([key]) => key === '__typename' || key.startsWith('getBookByLegacyId')),
    ),
  }
  let stubs = 0
  for (const [key, value] of Object.entries(state)) {
    if (!key.startsWith('Book:')) continue
    const book = value as Record<string, unknown>
    if (String(book.legacyId ?? '') === goodreadsId) kept[key] = book
    else if (stubs++ < 2) kept[key] = book
  }
  if (!Object.keys(kept).some((key) => key.startsWith('Book:'))) throw new Error(`no Book ${goodreadsId} in its own page`)
  const next = { props: { pageProps: { apolloState: kept } } }
  return [
    '<!doctype html>',
    `<!-- trimmed recording of ${bookPageUrl(goodreadsId)}: only the script the parser reads -->`,
    '<html><body>',
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`,
    '</body></html>',
  ].join('\n')
}

for (const [name, url] of Object.entries(RECORDINGS)) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } })
  await record(name, url, await response.text(), response.status, response.headers.get('content-type'))
}

for (const [name, goodreadsId] of Object.entries(BOOK_PAGES)) {
  const url = bookPageUrl(goodreadsId)
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, redirect: 'follow' })
  const html = await response.text()
  await record(name, url, trim(html, goodreadsId), response.status, response.headers.get('content-type'))
}
