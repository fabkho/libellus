import { readdirSync, readFileSync } from 'node:fs'

/**
 * OpenLibrary's answers, as recorded from its search API on 3 Oct 2026
 * (tests/fixtures/openlibrary), with the reduced field list the app asks for.
 * The search tests and the Playwright flows answer every request to
 * openlibrary.org from here, so no automated test ever calls the live API.
 * Queries without a recording get an empty answer. A work's editions list
 * (`/works/<key>/editions.json`, issue #41) answers from `editions-<key>.json`,
 * recorded the same day and trimmed to the fields the app reads.
 */
const RECORDED_TERMS: Record<string, string> = { piranesi: 'piranesi', 'klara und die sonne': 'klara' }

const fixtures = new URL('../fixtures/openlibrary/', import.meta.url)

function read(name: string): unknown | null {
  try {
    return JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), 'utf8'))
  } catch {
    return null
  }
}

/** The recorded answer to a request to OpenLibrary's search API. */
export function openLibraryAnswer(url: URL): unknown {
  const work = /^\/works\/(OL\d+W)\/editions\.json$/.exec(url.pathname)
  if (work) return read(`editions-${work[1]}`) ?? { size: 0, entries: [] }
  const isbn = url.searchParams.get('isbn')
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const edition = /^edition_key:(ol\d+m)$/.exec(q)
  const name = isbn
    ? `isbn-${isbn}`
    : edition
      ? `edition-${edition[1]!.toUpperCase()}`
      : `search-${RECORDED_TERMS[q] ?? 'nothing'}`
  return read(name) ?? { numFound: 0, docs: [] }
}

/** Every edition key in the recordings: the Books a flow can put into the Catalogue from OpenLibrary. */
export function recordedOpenLibraryKeys(): string[] {
  const keys = new Set<string>()
  for (const file of readdirSync(fixtures)) {
    if (!file.endsWith('.json')) continue
    const body = JSON.parse(readFileSync(new URL(file, fixtures), 'utf8')) as {
      docs?: { cover_edition_key?: string; editions?: { docs?: { key?: string }[] } }[]
      entries?: { key?: string }[]
    }
    for (const edition of body.entries ?? []) if (edition.key) keys.add(edition.key.replace('/books/', ''))
    for (const doc of body.docs ?? []) {
      for (const edition of doc.editions?.docs ?? []) if (edition.key) keys.add(edition.key.replace('/books/', ''))
      if (doc.cover_edition_key) keys.add(doc.cover_edition_key)
    }
  }
  return [...keys]
}
