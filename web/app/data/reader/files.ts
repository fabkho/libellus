/**
 * The reader's own files (the `ebook-reader` chunks: components/reader/Reader.vue, its sheets, the engine, the
 * sanitizer), as this build knows them. The list is written into the app's own code: the build replaces the
 * `__LIBELLUS_READER_FILES__` marker utils/readerChunks.ts carries (nuxt.config.ts, `libellus-reader-files`).
 * It is never read from the site, whose current list is the newest build's — after a release that is not this
 * build's list, and warming files this build's `import()` will never ask for leaves the import itself
 * unprotected: a stale app then dies mid-import and the browser keeps that failed `import()` for good.
 */

/**
 * The files of the running build's own list. A build or a dev server without the replacement has none, and
 * nothing is warmed: the import fetches what it needs.
 */
export function parseReaderFiles(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((file): file is string => typeof file === 'string') : []
  } catch {
    return []
  }
}

/**
 * Brings every file into the cache (the service worker's or the HTTP one), its bytes read, or throws naming the
 * first that is not there. Only once they are all in does utils/readerChunks.ts import: an `import()` that dies
 * mid-download is kept failed by the browser for the life of the page, while a `fetch` that dies leaves nothing
 * behind and the next tap tries again. A file the site no longer has (a build left behind by a release) fails
 * here — the member is told the book could not be opened, and nothing poisons itself.
 */
export async function fetchReaderFiles(files: string[], fetcher: typeof fetch = fetch): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      const response = await fetcher(`/${file}`)
      if (!response.ok) throw new Error(`${file}: ${response.status}`)
      await response.arrayBuffer()
    }),
  )
}
