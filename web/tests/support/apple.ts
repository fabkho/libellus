import { readdirSync, readFileSync } from 'node:fs'

/**
 * Apple's answers, as recorded from the iTunes Search API on 2 Oct 2026
 * (tests/fixtures/apple). The search tests and the Playwright flows answer
 * every request to itunes.apple.com from here, so no automated test ever
 * calls the live API. Queries without a recording get an empty answer.
 */
const RECORDED_TERMS: Record<string, string> = { piranesi: 'piranesi', 'klara und die sonne': 'klara' }

const fixtures = new URL('../fixtures/apple/', import.meta.url)

function read(name: string): unknown | null {
  try {
    return JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), 'utf8'))
  } catch {
    return null
  }
}

/** The recorded answer to a request to the iTunes Search API. */
export function appleAnswer(url: URL): unknown {
  const country = url.searchParams.get('country')
  let name: string
  if (url.pathname === '/search') {
    const term = (url.searchParams.get('term') ?? '').trim().toLowerCase()
    name = `search-${RECORDED_TERMS[term] ?? 'nothing'}-${country}`
  } else {
    const isbn = url.searchParams.get('isbn')
    name = isbn ? `lookup-isbn-${isbn}-${country}` : `lookup-${url.searchParams.get('id')}-${country}`
  }
  return read(name) ?? { resultCount: 0, results: [] }
}

/** A recorded cover (Piranesi, 200 × 300), served for every artwork request in the flows. */
export function appleCover(): Buffer {
  return readFileSync(new URL('cover.jpg', fixtures))
}

/** Every Apple id in the recordings: the Books a flow can put into the Catalogue. */
export function recordedAppleIds(): string[] {
  const ids = new Set<string>()
  for (const file of readdirSync(fixtures)) {
    if (!file.endsWith('.json')) continue
    const body = JSON.parse(readFileSync(new URL(file, fixtures), 'utf8')) as { results?: { trackId?: number }[] }
    for (const item of body.results ?? []) if (item.trackId) ids.add(String(item.trackId))
  }
  return [...ids]
}
