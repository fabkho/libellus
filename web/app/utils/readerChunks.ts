import { createReaderPrefetch, type Connection } from '~/data/reader/prefetch'

/**
 * The reader's code, fetched ahead (data/reader/prefetch.ts says when). The same two dynamic imports the Book
 * page makes on Read now (`LazyReader`, and the engine from components/reader/Reader.vue): the browser's module
 * map keeps the answers, so the tap finds both loaded and the reader opens at once. Both are in the `reader`
 * chunk (nuxt.config.ts), which the service worker caches as it is fetched (CacheFirst).
 *
 * Only a started fetch is a failed one: the browser keeps a failed `import()` in its module map, so one that
 * dies mid-download (the connection drops) makes Read now fail until the app is reloaded. Hence the conditions
 * in data/reader/prefetch.ts (online, no Save-Data) and a fetch that starts only when it is wanted.
 */
function connection(): Connection {
  const info = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return { online: navigator.onLine, saveData: info?.saveData === true }
}

const ahead = createReaderPrefetch(
  () => Promise.all([import('~/components/reader/Reader.vue'), import('~/reader/engine')]),
  connection,
)

/** Fetches the reader's code in the background, once. Client only. */
export function prefetchReader(): void {
  if (import.meta.client) ahead.prefetch()
}
