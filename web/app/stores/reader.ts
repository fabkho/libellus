import { defineStore } from 'pinia'
import type { LibraryEntry } from '~/data/library'
import { progressOf, type ProgressValue } from '~/data/progress'
import { createReaderPlaces, type ReaderPlaces } from '~/data/readerPlaces'
import { define as lookUpDefinition, translate as lookUpTranslation, type DeviceTranslator } from '~/data/reader/lookup'
import { openingPlace, readHighlights, readPlace, writeHighlights, writePlace, type Highlight, type Place } from '~/data/reader/device'
import { readSettings, writeSettings, type ReaderSettings } from '~/data/reader/settings'
import { isoDay } from '~/utils/dates'
import { useLibraryStore } from '~/stores/library'
import { useProgressDaysStore } from '~/stores/progressDays'
import { useSessionStore } from '~/stores/session'

/**
 * The built-in reader (#131 phase 2): which Book is open, the device's reading
 * settings (the Aa sheet and the Profile's Classic reader row), and what the
 * reader writes — progress, forward only, through the Library's own progress
 * path (`updateProgress`, waiting in the outbox while offline), and the place
 * in the book, on the device and server-side (best effort, online only) so
 * another device with the same file opens there.
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

  function highlightsFor(entryId: string): Highlight[] {
    const memberId = session.member?.id
    return memberId ? readHighlights(window.localStorage, memberId, entryId) : []
  }
  function keepHighlights(entryId: string, list: readonly Highlight[]) {
    const memberId = session.member?.id
    if (memberId) writeHighlights(window.localStorage, memberId, entryId, list)
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
    highlightsFor,
    keepHighlights,
    translate,
    define,
    reset,
  }
})
