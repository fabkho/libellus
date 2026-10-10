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

/**
 * The fetch ahead, once: `load` imports the reader's modules, whose answer the browser keeps (the module map), so
 * a second call has nothing to do and the member's tap is answered from memory. A failed attempt (no connection,
 * a deploy replaced the chunk) is forgotten, so the next call tries again.
 */
export function createReaderPrefetch(load: () => Promise<unknown>, connection: () => Connection) {
  let started: Promise<void> | null = null
  return {
    /** Starts the fetch unless it is on its way, done, or not wanted here; never throws. */
    prefetch(): void {
      if (started || !mayPrefetch(connection())) return
      started = load().then(
        () => undefined,
        () => {
          started = null
        },
      )
    },
    /** Whether the modules are (or are being) fetched; for the tests. */
    get started() {
      return started !== null
    },
  }
}
