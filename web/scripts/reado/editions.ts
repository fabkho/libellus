import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BookSnapshot } from '../../app/data/books'
import { createSearch, type Search } from '../../app/data/search'
import { isbnLanguage } from '../../app/data/import/readingTracker'
import { nodeFetch } from '../fable/node'

/**
 * Titles for the Reado import. The export names a book by ISBN and nothing else
 * (no title, author or cover), so every ISBN is looked up the way the app
 * looks one up when a member scans a barcode: Apple Books in the storefronts of
 * its language, then OpenLibrary (`Search.lookupIsbn`, app/data/search.ts). What
 * was found, or known not to exist, is kept in `.data/` so a rerun asks nobody
 * anything it already knows; an ISBN nobody could be asked about (a rejection:
 * rate limit, no network) is not kept and is tried again next run.
 */

export interface EditionResult {
  /** The edition per ISBN-13. */
  found: Map<string, BookSnapshot>
  /** ISBNs neither source knows: reported, not imported. */
  missing: string[]
  /** ISBNs that could not be asked about (run again to retry). */
  failed: string[]
}

export class EditionCache {
  private editions: Record<string, BookSnapshot | null> = {}

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { version?: number; editions?: Record<string, BookSnapshot | null> }
      if (data.version === 1) this.editions = data.editions ?? {}
    }
  }

  has(isbn13: string): boolean {
    return isbn13 in this.editions
  }

  get(isbn13: string): BookSnapshot | null {
    return this.editions[isbn13] ?? null
  }

  set(isbn13: string, edition: BookSnapshot | null) {
    this.editions[isbn13] = edition
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(`${this.path}.tmp`, `${JSON.stringify({ version: 1, editions: this.editions }, null, 1)}\n`)
    renameSync(`${this.path}.tmp`, this.path)
  }
}

export async function resolveEditions(
  isbns: readonly string[],
  options: { cachePath: string; offline: boolean; refresh: boolean; log: (line: string) => void },
): Promise<EditionResult> {
  const { offline, refresh, log } = options
  const cache = new EditionCache(options.cachePath)
  const fetch = nodeFetch(log)
  const searches: Record<string, Search> = {}
  // A German ISBN is looked up in the German storefront first, as a German reader's device would.
  const searchFor = (isbn13: string) => {
    const language = isbnLanguage(isbn13) === 'de' ? 'de' : 'en'
    return (searches[language] ??= createSearch({ fetch, languages: [language] }))
  }

  const result: EditionResult = { found: new Map(), missing: [], failed: [] }
  let asked = 0
  for (const isbn13 of isbns) {
    if (!refresh && cache.has(isbn13)) {
      const edition = cache.get(isbn13)
      if (edition) result.found.set(isbn13, edition)
      else result.missing.push(isbn13)
      continue
    }
    if (offline) {
      result.failed.push(isbn13)
      continue
    }
    try {
      const edition = await searchFor(isbn13).lookupIsbn(isbn13)
      cache.set(isbn13, edition)
      asked++
      log(`  title ${String(asked).padStart(3)} ${isbn13}: ${edition ? edition.title : 'not found'}`)
      if (edition) result.found.set(isbn13, edition)
      else result.missing.push(isbn13)
    } catch {
      result.failed.push(isbn13)
    }
  }
  return result
}
