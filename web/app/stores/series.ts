import { defineStore } from 'pinia'
import {
  createSeries,
  type BookSeries,
  type EnrichErrorCode,
  type SeriesCorrection,
  type SeriesInfo,
  type SeriesRepository,
  type StartedSeries,
} from '~/data/enrich'
import { LIMITS, remembered } from '~/data/enrich/device'
import { useEnrichCopyStore } from '~/stores/enrichCopy'
import { useSessionStore } from '~/stores/session'

/** How many started series Home asks for: all of them, for its sheet. */
const STARTED_LIMIT = 100

/** What the series sheet shows: a series of the Book, and which Book it was opened from. */
export type SeriesSheet = { seriesId: string; bookId: string }
/** What the edit sheet corrects: her entry of a Book. */
export type SeriesEditing = { entryId: string; bookId: string }

/**
 * Series (issue #167): the Book page's series line (`book_series_info`), the
 * series sheet with its works and her statuses (`series_works`), Home's "Next
 * in your series" (`started_series`: the series she has started and not finished) and her own correction of a Book's
 * series and position (set, "in no series", back to the suggested one), and
 * muting a whole series (online only, like her correction). What
 * was read last is kept on the device (stores/enrichCopy.ts), so the line, the
 * sheet and Home's row show offline; corrections need a connection (the
 * repository refuses them offline, the sheet says so).
 */
export const useSeriesStore = defineStore('series', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const copy = useEnrichCopyStore()
  const nuxtApp = useNuxtApp()

  let repository: SeriesRepository | null = null
  function series(): SeriesRepository | null {
    if (!backend) return null
    repository ??= createSeries(backend, { online: isOnline })
    return repository
  }
  const language = () => String(nuxtApp.$i18n?.locale?.value ?? 'en')

  // ------------------------------------------------------- a Book's series

  /** A Book's series as this device knows them (undefined: never asked). */
  function ofBook(bookId: string): BookSeries | undefined {
    return copy.data.bookSeries[bookId]
  }

  function keepBook(bookId: string, data: BookSeries) {
    copy.update((c) => ({ bookSeries: remembered(c.bookSeries, bookId, data, LIMITS.bookSeries) }))
    // The sheets of its series now know her place too.
    for (const place of data.series) keepSeries(place.id, place)
  }

  async function loadForBook(bookId: string) {
    const repo = series()
    if (!repo || !isOnline()) return
    const member = session.member?.id
    const result = await repo.forBook(bookId, language())
    if (result.error || member !== session.member?.id) return
    keepBook(bookId, result.data)
  }

  // ------------------------------------------------------- one series

  function info(seriesId: string): SeriesInfo | undefined {
    return copy.data.series[seriesId]
  }

  function keepSeries(seriesId: string, data: SeriesInfo) {
    const { id, name, wikidataId, parentId, parentName, source, count, works } = data
    copy.update((c) => ({ series: remembered(c.series, seriesId, { id, name, wikidataId, parentId, parentName, source, count, works }, LIMITS.series) }))
  }

  async function loadSeries(seriesId: string) {
    const repo = series()
    if (!repo || !isOnline()) return
    const member = session.member?.id
    const result = await repo.series(seriesId, language())
    if (result.error || !result.data || member !== session.member?.id) return
    keepSeries(seriesId, result.data)
  }

  // ------------------------------------------------- next in your series

  /** The series she has started and not finished, latest activity first, as this device last knew them. */
  const started = computed<StartedSeries[]>(() => copy.data.started ?? [])
  /** The started series she muted, as this device last knew them. */
  const muted = computed<StartedSeries[]>(() => copy.data.muted ?? [])

  async function loadStarted() {
    const repo = series()
    if (!repo || !isOnline()) return
    const member = session.member?.id
    const [open, hidden] = await Promise.all([repo.started(STARTED_LIMIT, language()), repo.muted(STARTED_LIMIT, language())])
    if (member !== session.member?.id) return
    // Each list is kept as soon as it is answered; a failed one keeps the device's copy.
    copy.update(() => ({
      ...(open.error ? {} : { started: open.data }),
      ...(hidden.error ? {} : { muted: hidden.data }),
    }))
  }

  /** The series being muted or unmuted, and why the last one was refused. */
  const muting = ref<string | null>(null)
  const muteError = ref<EnrichErrorCode | null>(null)

  /**
   * Mutes (or unmutes) a whole series. Online only: nothing is queued, and the device's copy
   * changes only once the server has answered. Returns the error code, or null when it is done.
   */
  async function setMuted(seriesId: string, on: boolean): Promise<EnrichErrorCode | null> {
    const repo = series()
    if (!repo || muting.value) return null
    muting.value = seriesId
    muteError.value = null
    const member = session.member?.id
    try {
      const result = on ? await repo.mute(seriesId) : await repo.unmute(seriesId)
      if (result.error) {
        muteError.value = result.error
        return result.error
      }
      if (member !== session.member?.id) return null
      // The row moves from one list to the other at once; the lists are then asked again for what the server says.
      copy.update((c) => moveMuted({ started: c.started ?? [], muted: c.muted ?? [] }, seriesId, on))
      void loadStarted()
      return null
    } finally {
      muting.value = null
    }
  }
  const mute = (seriesId: string) => setMuted(seriesId, true)
  const unmute = (seriesId: string) => setMuted(seriesId, false)

  // ------------------------------------------------------------- sheets

  const sheet = ref<SeriesSheet | null>(null)
  const editing = ref<SeriesEditing | null>(null)
  const busy = ref(false)
  const error = ref<EnrichErrorCode | null>(null)

  function openSheet(seriesId: string, bookId: string) {
    sheet.value = { seriesId, bookId }
    void loadSeries(seriesId)
  }

  function openEdit(entryId: string, bookId: string) {
    error.value = null
    editing.value = { entryId, bookId }
  }

  /** Her correction (a series and a position, or none), then the Book's series as they now are. Returns whether it was saved. */
  async function correct(how: { set: SeriesCorrection } | { clear: true } | { reset: true }): Promise<boolean> {
    const repo = series()
    const target = editing.value
    if (!repo || !target || busy.value) return false
    busy.value = true
    error.value = null
    try {
      const result = 'set' in how ? await repo.set(target.entryId, how.set) : 'clear' in how ? await repo.clear(target.entryId) : await repo.reset(target.entryId)
      if (result.error) {
        error.value = result.error
        return false
      }
      keepBook(target.bookId, result.data)
      // Home's row follows her correction.
      void loadStarted()
      return true
    } finally {
      busy.value = false
    }
  }

  function reset() {
    muting.value = null
    muteError.value = null
    sheet.value = null
    editing.value = null
    busy.value = false
    error.value = null
  }

  watch(
    () => session.member?.id,
    (now, before) => now !== before && reset(),
  )

  return { ofBook, loadForBook, info, loadSeries, started, muted, loadStarted, muting, muteError, mute, unmute, sheet, editing, busy, error, openSheet, openEdit, correct, reset }
})
