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
  // The cover search's cases (cover.ts): public books, the German editions the whole title or the ISBN finds.
  // Callie Hart, Blood & Roses - Buch 1 (Festa): the ISBN-13 finds it, the main title only the English series.
  'auto-complete-blood-roses-isbn-1': autoCompleteUrl('9783865527127'),
  'auto-complete-blood-roses-isbn-3': autoCompleteUrl('9783865527363'),
  'auto-complete-blood-roses-short': autoCompleteUrl('Blood & Roses Hart'),
  // Buch 2: no ISBN, the whole title finds it.
  'auto-complete-blood-roses-buch-2': autoCompleteUrl('Blood & Roses - Buch 2 Callie Hart'),
  'auto-complete-blood-roses-buch-1': autoCompleteUrl('Blood & Roses - Buch 1 Callie Hart'),
  // Jennifer L. Armentrout, Crown and Bones (Heyne): the title search ranks the English series' books; the ISBN-13 finds it.
  'auto-complete-crown-bones-isbn': autoCompleteUrl('9783453321540'),
  'auto-complete-crown-bones-title': autoCompleteUrl('Crown and Bones Jennifer L. Armentrout'),
  'auto-complete-crown-bones-short': autoCompleteUrl('Crown and Bones Armentrout'),
  // Morgane Moncomble, A Fall to Forgive: Goodreads' title is "A Fall to Forgive You".
  'auto-complete-fall-to-forgive': autoCompleteUrl('A Fall to Forgive Morgane Moncomble'),
  // Julie Murphy and Sierra Simone: Goodreads' title is "A Jingle Bell Mingle by Julie Murphy and Sierra Simone".
  'auto-complete-jingle-bell-mingle': autoCompleteUrl('A Jingle Bell Mingle Julie Murphy'),
  // Neil Gaiman, the Sandman volume asked by its whole title.
  'auto-complete-sandman-full': autoCompleteUrl('The Sandman, Vol. 5: A Game of You Neil Gaiman'),
}

for (const [name, url] of Object.entries(RECORDINGS)) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } })
  const body = await response.text()
  const recording = { url, status: response.status, contentType: response.headers.get('content-type'), body }
  await Deno.writeTextFile(new URL(`./fixtures/${name}.json`, import.meta.url), `${JSON.stringify(recording, null, 2)}\n`)
  console.log(name, response.status, body.length)
  await new Promise((resolve) => setTimeout(resolve, 2000))
}
