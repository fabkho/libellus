import { fetchReaderFiles, parseReaderFiles } from '~/data/reader/files'
import { createReaderPrefetch, type Connection } from '~/data/reader/prefetch'

/**
 * The reader's code (data/reader/prefetch.ts says when it is fetched ahead): the same two dynamic imports the
 * Book page makes on Read now (`LazyReader`, and the engine from components/reader/Reader.vue). The browser's
 * module map keeps the answers, so a tap finds both loaded and the reader opens at once. Both are in the
 * `ebook-reader` chunks (nuxt.config.ts), which the service worker caches as they are fetched (CacheFirst).
 *
 * The browser also keeps a *failed* `import()` for good: one that dies mid-download would make Read now fail until
 * the app is reloaded. So the files are fetched with `fetch` first (a failure there leaves nothing behind and
 * is tried again) and only imported once they are all in the HTTP or service worker cache. The list of files is
 * the running build's own, written into this code at build time (data/reader/files.ts): the site's current list
 * would be the newest build's, and after a release it names files this build's `import()` never asks for — the
 * guard would pass and the import itself would die, poisoned, where the member taps and nothing happens.
 */
function connection(): Connection {
  const info = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return { online: navigator.onLine, saveData: info?.saveData === true }
}

/** The build replaces this marker with the JSON list of the reader's files (nuxt.config.ts, `libellus-reader-files`). */
const files = parseReaderFiles('__LIBELLUS_READER_FILES__')

async function load(): Promise<void> {
  await fetchReaderFiles(files)
  await Promise.all([import('~/components/reader/Reader.vue'), import('~/reader/engine')])
}

const ahead = createReaderPrefetch(load, connection)

/** Fetches the reader's code in the background, once; tries again later if that failed. Client only. */
export function prefetchReader(): void {
  if (import.meta.client) ahead.prefetch()
}

/**
 * Read now: makes sure the reader's code is in, loading it if it never was or an earlier attempt failed (any
 * connection: a tap is a request). Resolves at once when it is loaded; rejects when it could not be (offline,
 * or a build whose files the site no longer has), which the caller turns into words for the member — opening
 * the reader then would show nothing at all, its component being the very code that could not load.
 */
export function loadReader(): Promise<void> {
  return import.meta.client ? ahead.ensure() : Promise.resolve()
}
