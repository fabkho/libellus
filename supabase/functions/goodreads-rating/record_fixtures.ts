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

for (const [name, url] of Object.entries(RECORDINGS)) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } })
  const body = await response.text()
  const recording = { url, status: response.status, contentType: response.headers.get('content-type'), body }
  await Deno.writeTextFile(new URL(`./fixtures/${name}.json`, import.meta.url), `${JSON.stringify(recording, null, 2)}\n`)
  console.log(name, response.status, body.length)
  await new Promise((resolve) => setTimeout(resolve, 2000))
}
