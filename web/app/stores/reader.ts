import { defineStore } from 'pinia'
import type { LibraryEntry } from '~/data/library'
import { progressOf, type ProgressValue } from '~/data/progress'
import { createReaderPlaces, type ReaderPlaces } from '~/data/readerPlaces'
import {
  adoptLegacy,
  createReaderHighlights,
  fromAnotherCopy,
  highlightWrite,
  markSent,
  mergeHighlights,
  placedOn,
  toEngine,
  unsent,
  withHighlight,
  withoutHighlightId,
  withoutHighlight,
  type ReaderHighlight,
  type ReaderHighlights,
} from '~/data/readerHighlights'
import { isLocalId, uuid } from '~/data/queuedWrites'
import { define as lookUpDefinition, translate as lookUpTranslation, type DeviceTranslator } from '~/data/reader/lookup'
import { openingPlace, readHighlights, readPlace, writeHighlights, writePlace, type Highlight, type LocalHighlight, type Place } from '~/data/reader/device'
import { readSettings, writeSettings, type ReaderSettings } from '~/data/reader/settings'
import { isoDay } from '~/utils/dates'
import { useLibraryStore } from '~/stores/library'
import { useProgressDaysStore } from '~/stores/progressDays'
import { useSessionStore } from '~/stores/session'
import { useSyncStore } from '~/stores/sync'

/**
 * The built-in reader (#131 phase 2): which Book is open, the device's reading
 * settings (the Aa sheet and the Profile's Classic reader row), and what the
 * reader writes — progress, forward only, through the Library's own progress
 * path (`updateProgress`, waiting in the outbox while offline), and the place
 * in the book, on the device and server-side (best effort, online only) so
 * another device with the same file opens there, and the highlights, kept on
 * the device first and synced through the outbox (data/readerHighlights.ts).
 */
export const useReaderStore = defineStore('reader', () => {
  const library = useLibraryStore()
  const progressDays = useProgressDaysStore()
  const session = useSessionStore()
  const backend = useBackend()

  // ------------------------------------------------------------ settings (this device)

  const settings = reactive<ReaderSettings>(import.meta.client ? readSettings(window.localStorage) : readSettings({ getItem: () => null }))
  if (import.meta.client) watch(settings, (value) => writeSettings(window.localStorage, value), { deep: true })

  // ------------------------------------------------------------ the open book

  /** The entry whose book is open in the reader, on its book page. */
  const openEntryId = ref<string | null>(null)
  function open(entry: LibraryEntry) {
    openEntryId.value = entry.id
  }
  function close() {
    openEntryId.value = null
  }

  // ------------------------------------------------------------ progress

  /**
   * Writes the reader's progress for `entry` (the writer has already checked it is
   * ahead of what is saved). The Library takes the changed entry in, the reading
   * days their new day. Failures are quiet: the next rest on a page tries again,
   * and the member can always set it herself.
   */
  async function saveProgress(entry: LibraryEntry, value: ProgressValue): Promise<void> {
    const repo = library.library()
    if (!repo) return
    const result = await repo.updateProgress(entry.id, value, undefined, isoDay())
    if (result.error) return
    library.entryChanged(result.data)
    progressDays.refresh(result.data.latestSession?.id)
  }
  /** The entry as the Library holds it now (progress moves while the reader is open). */
  function current(entryId: string): LibraryEntry | null {
    return [...library.reading, ...library.wantToRead, ...library.finished].find((e) => e.id === entryId) ?? null
  }
  function progressFor(entryId: string): ProgressValue | null {
    return progressOf(current(entryId)?.latestSession)
  }

  // ------------------------------------------------------------ the place and highlights

  let places: ReaderPlaces | null = null
  function placesRepo(): ReaderPlaces {
    places ??= createReaderPlaces(backend, { online: isOnline })
    return places
  }

  /** Where to open `entryId`'s copy (`fileHash`): the newer of the device's place and the server's. */
  async function openingPlaceFor(entryId: string, fileHash: string): Promise<{ cfi: string } | { fraction: number } | null> {
    const memberId = session.member?.id
    if (!memberId) return null
    const local = readPlace(window.localStorage, memberId, entryId)
    let remote: Place | null = null
    // The server's answer only gets a moment: the book never waits for the network.
    const answer = await Promise.race([
      placesRepo().get(entryId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 800)),
    ])
    if (answer && !answer.error && answer.data) {
      remote = { cfi: answer.data.cfi, fraction: answer.data.fraction, fileHash: answer.data.fileHash, at: answer.data.updatedAt }
    }
    return openingPlace(local, remote, fileHash)
  }

  let placeTimer: ReturnType<typeof setTimeout> | undefined
  /** The reader is somewhere new: kept on the device at once, sent to the server after a rest (and on close). */
  function leavePlace(entryId: string, place: Omit<Place, 'at'>, { now = false }: { now?: boolean } = {}) {
    const memberId = session.member?.id
    if (!memberId) return
    const stamped: Place = { ...place, at: new Date().toISOString() }
    writePlace(window.localStorage, memberId, entryId, stamped)
    clearTimeout(placeTimer)
    const send = () => void placesRepo().save({ entryId, cfi: stamped.cfi, fraction: stamped.fraction, fileHash: stamped.fileHash, at: stamped.at })
    if (now) send()
    else placeTimer = setTimeout(send, 5000)
  }

  // ------------------------------------------------------------ highlights (device first, then the server)

  let highlightsRepo: ReaderHighlights | null = null
  function highlightsRepository(): ReaderHighlights {
    highlightsRepo ??= createReaderHighlights(backend, { online: isOnline })
    return highlightsRepo
  }

  /** Every highlight the device holds per entry (tombstones too), as the page and the Contents sheet read them. */
  const highlightLists = shallowRef<Record<string, readonly LocalHighlight[]>>({})

  function storedHighlights(memberId: string, entryId: string): readonly LocalHighlight[] {
    return highlightLists.value[entryId] ?? readHighlights(window.localStorage, memberId, entryId).kept
  }
  function keepHighlights(memberId: string, entryId: string, list: readonly LocalHighlight[]) {
    writeHighlights(window.localStorage, memberId, entryId, list)
    highlightLists.value = { ...highlightLists.value, [entryId]: list }
  }

  /** What the page draws for this copy of the book (`fileHash`): live highlights made in the same file. */
  function highlightsFor(entryId: string, fileHash: string): Highlight[] {
    const memberId = session.member?.id
    return memberId ? placedOn(storedHighlights(memberId, entryId), fileHash).map(toEngine) : []
  }
  /** Highlights made in another file of this book: listed in the Contents sheet, never placed. */
  function highlightsFromAnotherCopy(entryId: string, fileHash: string): readonly ReaderHighlight[] {
    const memberId = session.member?.id
    return memberId ? fromAnotherCopy(storedHighlights(memberId, entryId), fileHash) : []
  }

  /** The Book's title, what a waiting change is called in the sync sheet. */
  const aboutEntry = (entryId: string) => current(entryId)?.book.title ?? ''

  /**
   * Hands every change the outbox has not got yet to it (oldest first), then
   * marks it handed over. The outbox keeps it on the device and sends it, once,
   * when there is a connection; a change made again meanwhile stays unsent.
   */
  let sending: Promise<void> = Promise.resolve()
  /** One hand-over at a time, so a change is never put in the outbox twice. */
  function sendHighlights(memberId: string, entryId: string): Promise<void> {
    sending = sending.then(() => handOver(memberId, entryId)).catch(() => undefined)
    return sending
  }
  async function handOver(memberId: string, entryId: string): Promise<void> {
    const box = useSyncStore()
    for (const h of unsent(storedHighlights(memberId, entryId))) {
      try {
        await box.queue.add(highlightWrite(h, aboutEntry(entryId)))
      } catch {
        return // nobody is signed in any more
      }
      if (session.member?.id !== memberId) return
      keepHighlights(memberId, entryId, markSent(storedHighlights(memberId, entryId), h.id, h.updatedAt))
    }
  }

  /** A highlight made, or recoloured, on this copy: kept on the device at once, sent through the outbox. */
  function saveHighlight(entryId: string, fileHash: string, highlight: Highlight) {
    const memberId = session.member?.id
    if (!memberId) return
    keepHighlights(memberId, entryId, withHighlight(storedHighlights(memberId, entryId), entryId, fileHash, highlight, new Date(), uuid))
    void sendHighlights(memberId, entryId)
  }
  /** A highlight removed on this copy: a tombstone, so another device drops it too. */
  function removeHighlight(entryId: string, fileHash: string, cfi: string) {
    const memberId = session.member?.id
    if (!memberId) return
    keepHighlights(memberId, entryId, withoutHighlight(storedHighlights(memberId, entryId), fileHash, cfi, new Date()))
    void sendHighlights(memberId, entryId)
  }
  /** A highlight from another copy removed from its list. */
  function removeHighlightById(entryId: string, id: string) {
    const memberId = session.member?.id
    if (!memberId) return
    keepHighlights(memberId, entryId, withoutHighlightId(storedHighlights(memberId, entryId), id, new Date()))
    void sendHighlights(memberId, entryId)
  }

  const highlightRuns = new Map<string, Promise<void>>()
  /**
   * Brings the device's highlights and the server's together for one entry:
   * those from before the sync are given ids, whatever is not in the outbox goes
   * into it, then the server's list is read (online) and merged, the newer
   * change of each highlight winning. One run per entry at a time.
   */
  function syncHighlights(entryId: string, fileHash: string): Promise<void> {
    const memberId = session.member?.id
    if (!memberId || isLocalId(entryId)) return Promise.resolve()
    const run = (highlightRuns.get(entryId) ?? Promise.resolve()).then(async () => {
      if (session.member?.id !== memberId) return
      const stored = readHighlights(window.localStorage, memberId, entryId)
      const known = highlightLists.value[entryId] ?? stored.kept
      const adopted = adoptLegacy(stored.legacy, fileHash, entryId, new Date(), uuid)
      if (adopted.length || !highlightLists.value[entryId]) keepHighlights(memberId, entryId, [...known, ...adopted])
      await sendHighlights(memberId, entryId)
      const remote = await highlightsRepository().list(entryId)
      if (remote.error || session.member?.id !== memberId) return
      // Read again after the wait: the member may have highlighted while the answer was on its way.
      keepHighlights(memberId, entryId, mergeHighlights(storedHighlights(memberId, entryId), remote.data))
      await sendHighlights(memberId, entryId)
    })
    const settled = run.catch(() => undefined)
    highlightRuns.set(entryId, settled)
    void settled.then(() => highlightRuns.get(entryId) === settled && highlightRuns.delete(entryId))
    return run
  }

  /** How long the book waits for the server's highlights before it opens with the device's (the place waits as long). */
  const HIGHLIGHTS_WAIT_MS = 800
  /** While the reader stays open the server's list is read again this often. */
  const HIGHLIGHTS_POLL_MS = 60_000

  /** The highlights to open the copy `fileHash` with: the device's, joined by the server's if they come in time. */
  async function openHighlights(entryId: string, fileHash: string): Promise<Highlight[]> {
    await Promise.race([syncHighlights(entryId, fileHash).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, HIGHLIGHTS_WAIT_MS))])
    return highlightsFor(entryId, fileHash)
  }

  /**
   * Keeps the open book's highlights up to date in the background: read again
   * every minute while the page is visible, when the app comes back to the
   * foreground and when the connection returns. Returns how to stop.
   */
  function followHighlights(entryId: string, fileHash: string): () => void {
    const tick = () => {
      if (document.visibilityState === 'visible' && isOnline()) void syncHighlights(entryId, fileHash).catch(() => undefined)
    }
    const timer = setInterval(tick, HIGHLIGHTS_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('online', tick)
    }
  }

  // ------------------------------------------------------------ Translate and Define (only the selected words leave the device)

  function translate(text: string, from: string, to: string, signal?: AbortSignal) {
    const device = (globalThis as unknown as { Translator?: DeviceTranslator }).Translator ?? null
    return lookUpTranslation(fetch, text, from, to, { device, online: isOnline, signal })
  }
  function define(text: string, language: string, signal?: AbortSignal) {
    return lookUpDefinition(fetch, text, language, { online: isOnline, signal })
  }

  function reset() {
    openEntryId.value = null
    places = null
    highlightsRepo = null
    highlightLists.value = {}
    highlightRuns.clear()
    clearTimeout(placeTimer)
  }
  // Another member, or nobody: nothing of the last one's reading stays in memory.
  watch(
    () => session.member?.id,
    () => reset(),
  )

  return {
    settings,
    openEntryId,
    open,
    close,
    saveProgress,
    current,
    progressFor,
    openingPlaceFor,
    leavePlace,
    highlightLists,
    highlightsFor,
    highlightsFromAnotherCopy,
    saveHighlight,
    removeHighlight,
    removeHighlightById,
    openHighlights,
    syncHighlights,
    followHighlights,
    translate,
    define,
    reset,
  }
})
