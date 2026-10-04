import { defineStore } from 'pinia'
import {
  createOutbox,
  createSender,
  indexedDbOutboxStorage,
  memoryOutboxStorage,
  type FlushReport,
  type Outbox,
  type OutboxItem,
  type SyncFailure,
} from '~/data/outbox'
import { COLLECTION_ACTIONS, type WriteQueue } from '~/data/queuedWrites'
import { useCollectionsStore } from '~/stores/collections'
import { useHistoryStore } from '~/stores/history'
import { useLibraryStore } from '~/stores/library'
import { useProgressDaysStore } from '~/stores/progressDays'
import { useSessionStore } from '~/stores/session'

/** The Background Sync tag the service worker wakes the app with (public/sw-sync.js). */
export const SYNC_TAG = 'libellus-outbox'
/** The message the service worker sends the open app when the browser says it may sync. */
export const SYNC_MESSAGE = 'libellus:sync'

/**
 * Save offline, sync later (issue #93): the member's outbox (data/outbox.ts) as
 * the screens see it, and when it is sent.
 *
 * The Library and Collections repositories write into it (`queue`) whenever it
 * holds writes: offline, or online while earlier ones have not synced yet. It is
 * sent, oldest first, when the app starts with a connection, when the browser
 * says the connection is back (`online`), when the app comes back to the
 * foreground, when the service worker's Background Sync fires (where the
 * browser has it), right after a write while online, and after a pause that
 * doubles when a send did not get through. After a flush that synced or refused
 * something the Library, the Collections, the open histories and the reading days
 * are read again: what the database has is what the screens show, the writes still
 * waiting laid over it. A refused write is undone that way and stays as a failure
 * the member can read and dismiss (`failures`, the sync sheet).
 *
 * `pending` is the number of writes waiting; nothing that waits is shown as synced.
 */
export const useSyncStore = defineStore('sync', () => {
  const backend = useBackend()
  const session = useSessionStore()

  const items = shallowRef<readonly OutboxItem[]>([])
  const failures = shallowRef<readonly SyncFailure[]>([])
  /** Writes waiting to sync. */
  const pending = computed(() => items.value.length)
  /** A flush is on its way. */
  const syncing = ref(false)
  /** The device's outbox has been read (until then a write waits, so it cannot overtake one from before). */
  const ready = ref(false)
  /** The sync sheet (components/shell/SyncSheet.vue): opened from the header's sync chip. */
  const sheetOpen = ref(false)

  let outbox: Outbox | null = null
  let unsubscribe: (() => void) | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function open(memberId: string) {
    close()
    if (!import.meta.client || !backend) return
    const storage = typeof indexedDB === 'undefined' ? memoryOutboxStorage() : indexedDbOutboxStorage(indexedDB)
    const box = createOutbox({ memberId, storage, send: createSender(backend) })
    outbox = box
    unsubscribe = box.subscribe(() => {
      if (outbox !== box) return
      items.value = [...box.items()]
      failures.value = [...box.failures()]
    })
    void box.ready.then(() => {
      if (outbox !== box) return
      ready.value = true
      // The device's copy may predate a write that waited (the app closed in between): laid over it again.
      useLibraryStore().rebase()
      void flush()
    })
  }

  /** Lets go of the member's outbox (signing out, another member): it writes nothing more. */
  function close() {
    unsubscribe?.()
    unsubscribe = null
    outbox?.close()
    outbox = null
    clearTimeout(retryTimer)
    items.value = []
    failures.value = []
    ready.value = false
    sheetOpen.value = false
  }

  /** Whether a write waits now: offline, before the outbox is read, or while earlier writes wait. */
  function holds(): boolean {
    if (!outbox) return false
    return !isOnline() || !ready.value || items.value.length > 0
  }

  /** What the repositories write into (data/queuedWrites.ts, WriteQueue). */
  const queue: WriteQueue = {
    holds,
    entry: (entryId) => useLibraryStore().entryById(entryId),
    entryForBook: (bookId) => useLibraryStore().entryForBook(bookId),
    collection: (collectionId) => useCollectionsStore().list.find((summary) => summary.id === collectionId) ?? null,
    async add(write) {
      const box = outbox
      if (!box) throw new Error('No outbox: nobody is signed in')
      const item = await box.add(write)
      askBackgroundSync()
      if (isOnline()) void flush()
      return item
    },
  }

  /** Sends what waits (data/outbox.ts, flush), then shows what the database has. */
  async function flush(): Promise<void> {
    const box = outbox
    if (!box || !ready.value || !isOnline() || syncing.value) return
    syncing.value = true
    clearTimeout(retryTimer)
    try {
      let report: FlushReport
      do {
        report = await box.flush()
        if (box !== outbox) return
        if (report.taken.length || report.refused.length) await settle(report)
        // A write made while the last one was on its way: its turn now.
      } while (report.retryAt === null && box.items().length > 0 && isOnline())
      if (report.retryAt !== null) retryTimer = setTimeout(() => void flush(), Math.max(report.retryAt - Date.now(), 0))
    } finally {
      syncing.value = false
    }
  }

  /** After a flush: the screens read what the database has now (undoing what a refused write showed). */
  async function settle(report: FlushReport) {
    const library = useLibraryStore()
    const synced = [...report.taken.map((item) => item.action), ...report.refused.map((failure) => failure.action)]
    await library.load()
    if (library.readInYear !== null) void library.loadReadInYear()
    useHistoryStore().refresh()
    useProgressDaysStore().refreshAll()
    const collections = useCollectionsStore()
    // Collections show the Library's entries too; their own changes certainly.
    if (collections.loaded || synced.some((action) => COLLECTION_ACTIONS.has(action))) collections.refresh()
  }

  /** Forgets a failure the member has read. */
  async function dismiss(failureId: string) {
    await outbox?.dismiss(failureId)
  }

  /** Asks the browser to wake the app when it may sync (Background Sync, where there is one). */
  function askBackgroundSync() {
    if (!import.meta.client || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker.ready
      .then((registration) => (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync?.register(SYNC_TAG))
      .catch(() => undefined)
  }

  /** The connection is back (or the browser says it may sync): no more waiting out a pause. */
  function wake() {
    outbox?.wake()
    void flush()
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      if (now) open(now)
      else close()
    },
    { immediate: true },
  )

  watch(useOnline(), (now) => {
    if (now) wake()
  })

  if (import.meta.client) {
    // A phone resumes a frozen app without an `online` event: it tries as it comes back.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isOnline()) wake()
    })
    navigator.serviceWorker?.addEventListener('message', (event) => {
      if ((event.data as { type?: string } | null)?.type === SYNC_MESSAGE) wake()
    })
  }

  return { items, failures, pending, syncing, ready, sheetOpen, queue, holds, flush, dismiss, close }
})
