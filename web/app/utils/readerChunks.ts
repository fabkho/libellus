import { createReaderPrefetch, type Connection } from '~/data/reader/prefetch'

/**
 * The reader's code (data/reader/prefetch.ts says when it is fetched ahead): the same two dynamic imports the Book
 * page makes on Read now (`LazyReader`, and the engine from components/reader/Reader.vue). The browser's module
 * map keeps the answers, so a tap finds both loaded and the reader opens at once. Both are in the `ebook-reader`
 * chunks (nuxt.config.ts), which the service worker caches as they are fetched (CacheFirst).
 *
 * The browser also keeps a *failed* `import()` for good: one that dies mid-download would make Read now fail until
 * the app is reloaded. So the files are fetched with `fetch` first (a failure there leaves nothing behind and
 * is tried again) and only imported once they are all in the HTTP or service worker cache. The list of files is
 * written by the build (`builds/reader-files.json`, nuxt.config.ts).
 */
function connection(): Connection {
  const info = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return { online: navigator.onLine, saveData: info?.saveData === true }
}

/** Brings the reader's files into the cache. A build or a dev server without the list has nothing to bring: the import fetches them. */
async function fetchFiles(): Promise<void> {
  const list = await fetch('/_nuxt/builds/reader-files.json', { cache: 'no-cache' })
  if (!list.ok) return
  const files = (await list.json()) as string[]
  await Promise.all(
    files.map(async (file) => {
      const response = await fetch(`/${file}`)
      if (!response.ok) throw new Error(`${file}: ${response.status}`)
      await response.arrayBuffer()
    }),
  )
}

async function load(): Promise<void> {
  await fetchFiles()
  await Promise.all([import('~/components/reader/Reader.vue'), import('~/reader/engine')])
}

const ahead = createReaderPrefetch(load, connection)

/** Fetches the reader's code in the background, once; tries again later if that failed. Client only. */
export function prefetchReader(): void {
  if (import.meta.client) ahead.prefetch()
}

/**
 * Read now: makes sure the reader's code is in, loading it if it never was or an earlier attempt failed (any
 * connection: a tap is a request). Resolves at once when it is loaded; rejects when it could not be (offline),
 * which the caller ignores: opening the reader then fails as it always has, or finds the copy the service worker keeps.
 */
export function loadReader(): Promise<void> {
  return import.meta.client ? ahead.ensure() : Promise.resolve()
}
