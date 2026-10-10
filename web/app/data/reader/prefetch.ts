import type { EbooksSnapshot } from '../ebooks/snapshot'

/**
 * When the ebook reader is fetched ahead of its first opening. The reader (components/reader, the foliate-js
 * engine, the sanitizer: the `reader` chunk, about 80 KB brotli) is not in the service worker's precache
 * (nuxt.config.ts, `globIgnores`), so a member who has an ebook gets it before she asks: on idle once she is
 * signed in, and on a Book page whose entry has one. Read now then finds the chunks in memory and opens with no
 * loading state. Framework-free: the plugin, the Book page and the tests hand in what they know.
 */

/** What the device says about itself: no fetching ahead without a connection, nor for a member who asked to save data. */
export type Connection = { online: boolean; saveData: boolean }

/** Whether anything is fetched ahead. */
export function mayPrefetch({ online, saveData }: Connection): boolean {
  return online && !saveData
}

/**
 * Whether the member has an ebook that opens: a linked one whose copy is on this device. Read from the device's
 * snapshot of her ebooks (data/ebooks/snapshot.ts), which is there synchronously and holds the records the last
 * time they were read; nothing is read from IndexedDB for this. No snapshot, or her ebooks waiting for a Book,
 * is no ebook to open.
 */
export function hasOpenableEbook(ebooks: { records: EbooksSnapshot['records']; missing: Iterable<string> } | null): boolean {
  if (!ebooks) return false
  const missing = new Set(ebooks.missing)
  return ebooks.records.some((record) => record.state === 'linked' && !missing.has(record.id))
}

/**
 * The ebooks store's own trigger: the member has just linked her first ebook (no openable one a moment ago, and
 * the records were already read, so this is not the first read finding the ones she always had), so the
 * reader is fetched at once and is there before she taps Read now. An ebook the first read finds is the
 * plugin's case (plugins/reader-prefetch.client.ts): on idle, not at once.
 */
export function firstEbookLinked(before: boolean, now: boolean, recordsRead: boolean): boolean {
  return now && !before && recordsRead
}

/** Waits between a failed fetch ahead and its next try; as many tries as there are entries. */
export const RETRY_DELAYS_MS = [5000, 20_000, 60_000]

/**
 * The fetch ahead, once: `load` brings the reader's code in (data/reader/prefetch.ts's caller says how), and the
 * browser keeps the modules, so a second call has nothing to do and the member's tap is answered from memory.
 *
 * A failed `load` is never kept: the next call starts it again (the browser keeps a failed `import()` for good,
 * so `load` must make sure the files are in before it imports; utils/readerChunks.ts does). `prefetch` (the
 * triggers) tries again by itself after a failure, later and later, a few times, and only while the device
 * still allows it; `ensure` (Read now) loads whatever the connection, joins a load on its way, and says if it
 * failed.
 */
export function createReaderPrefetch(
  load: () => Promise<unknown>,
  connection: () => Connection,
  { delays = RETRY_DELAYS_MS, later = (run: () => void, ms: number) => void setTimeout(run, ms) }: { delays?: number[]; later?: (run: () => void, ms: number) => void } = {},
) {
  let loading: Promise<void> | null = null
  let tries = 0
  function run(): Promise<void> {
    loading ??= load().then(
      () => {
        tries = 0
      },
      (error: unknown) => {
        loading = null
        throw error
      },
    )
    return loading
  }
  function retry() {
    const delay = delays[tries++]
    if (delay !== undefined) later(prefetch, delay)
  }
  function prefetch(): void {
    if (loading || !mayPrefetch(connection())) return
    run().catch(retry)
  }
  return {
    /** Starts the fetch unless it is on its way, done, or not wanted here; never throws. */
    prefetch,
    /** Loads (or joins the load on its way) and resolves when the reader's code is in; rejects when it could not be. */
    ensure: run,
    /** Whether the code is being, or has been, fetched; for the tests. */
    get started() {
      return loading !== null
    },
  }
}
