/**
 * Records fixtures/openlibrary.json: what the live Open Library answers to every request the job's lookup makes for
 * the test rows (test_support.ts PIRANESI, NOBODY), the cover stage's too, so the work tests run the real matching code on real answers
 * without the network. Run by hand (identified, as the job is):
 *
 *   OPENLIBRARY_CONTACT=you@example.com deno run --allow-net --allow-read --allow-write --allow-env record_fixtures.ts
 */
import { findEdition } from '../../../web/app/data/bookImport.ts'
import { coverIsbns, openLibraryBooksUrl, openLibraryWorkUrl } from '../../../web/app/data/coverFill.ts'
import { createOpenLibrary, userAgent } from '../openlibrary/client.ts'
import { emptyCatalogue, functions, NOBODY, PIRANESI } from './test_support.ts'
import { jobFetch, jobSources } from './sources.ts'

const contact = Deno.env.get('OPENLIBRARY_CONTACT')
if (!contact) throw new Error('OPENLIBRARY_CONTACT, please')
const recorded: Record<string, string> = {}
const live = createOpenLibrary({ fetch: (input, init) => fetch(input, init), userAgent: userAgent(contact) })
const openLibrary = {
  async ask(path: string, query: string) {
    const answer = await live.ask(path, query)
    if (answer.status === 200) recorded[`https://openlibrary.org${path}${query ? `?${query}` : ''}`] = answer.body
    return answer
  },
}
const { fetch: sourcesFetch } = jobFetch({ openLibrary, fetch: (url, init) => fetch(url, init), userAgent: userAgent(contact) })
const { lookups } = jobSources({
  fetch: sourcesFetch,
  languages: ['de-DE', 'en-US'],
  catalogueClient: emptyCatalogue,
  functions: functions().client,
})
for (const row of [PIRANESI, NOBODY]) {
  const edition = await findEdition(row, lookups)
  console.error(`${row.key}: via ${edition.via}, ${edition.book.source}, cover ${Boolean(edition.book.coverUrl)}`)
}
// The cover stage's requests (covers.ts): `api/books` by the ISBN and the work's search, for the same rows.
for (const row of [PIRANESI, NOBODY]) {
  const isbns = coverIsbns({ row, book: { isbn13: null, isbn10: null } })
  if (isbns.length) await sourcesFetch(openLibraryBooksUrl(isbns))
  await sourcesFetch(openLibraryWorkUrl(row))
}
Deno.writeTextFileSync(new URL('./fixtures/openlibrary.json', import.meta.url), JSON.stringify(recorded, null, 1) + '\n')
console.error(`recorded ${Object.keys(recorded).length} answers`)
