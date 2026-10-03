import { defineStore } from 'pinia'
import type { LibraryEntry, LibraryErrorCode } from '~/data/library'
import { isoDay } from '~/utils/dates'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

/**
 * The Start and Finish sheets (issue #7): which entry each is about, what the
 * member has chosen so far, and the action's progress. Each action is one call
 * to the Library repository; on success the entry moves to its new list
 * (`library.entryChanged`) and the sheet closes, on failure the sheet stays
 * open with the reason and the same button tries again. Dates are the member's
 * own calendar days; the sheet refuses a day the database would refuse, so
 * the member hears why before anything is sent.
 */
export const useReadingStore = defineStore('reading', () => {
  const library = useLibraryStore()

  /** What the sheet's own checks find wrong with a day, before asking the database. */
  function checkDay(day: string, { notBefore }: { notBefore?: string | null } = {}): LibraryErrorCode | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'date_invalid'
    if (day > isoDay()) return 'date_in_future'
    if (notBefore && day < notBefore) return 'ended_before_started'
    return null
  }

  // ---------------------------------------------------------- Start reading

  /** The entry the Start sheet is about; null while it is closed. */
  const starting = ref<LibraryEntry | null>(null)
  const startedOn = ref('')
  const startBusy = ref(false)
  const startError = ref<LibraryErrorCode | null>(null)

  function openStart(entry: LibraryEntry) {
    starting.value = entry
    startedOn.value = isoDay()
    startError.value = null
  }

  function closeStart() {
    if (!startBusy.value) starting.value = null
  }

  /** Starts the read. Returns the entry, now Currently reading, or null with `startError` set. */
  async function confirmStart(): Promise<LibraryEntry | null> {
    const entry = starting.value
    const repo = library.library()
    if (!entry || !repo || startBusy.value) return null
    startError.value = checkDay(startedOn.value)
    if (startError.value) return null
    startBusy.value = true
    try {
      const result = await repo.startReading(entry.id, startedOn.value)
      if (result.error) {
        startError.value = result.error
        return null
      }
      library.entryChanged(result.data)
      starting.value = null
      return result.data
    } finally {
      startBusy.value = false
    }
  }

  // ----------------------------------------------------------------- Finish

  /** The entry the Finish sheet is about; null while it is closed. */
  const finishing = ref<LibraryEntry | null>(null)
  const endedOn = ref('')
  /** Quarter stars, 1–20, or null: unrated. */
  const rating = ref<number | null>(null)
  const review = ref('')
  const finishBusy = ref(false)
  const finishError = ref<LibraryErrorCode | null>(null)
  /** The entry the choices above were made for: reopening its sheet keeps them. */
  let draftFor: string | null = null

  function openFinish(entry: LibraryEntry) {
    finishing.value = entry
    finishError.value = null
    if (draftFor === entry.id) return
    draftFor = entry.id
    endedOn.value = isoDay()
    rating.value = null
    review.value = ''
  }

  function closeFinish() {
    if (!finishBusy.value) finishing.value = null
  }

  /** Finishes the read. Returns the entry, now Finished, or null with `finishError` set. */
  async function confirmFinish(): Promise<LibraryEntry | null> {
    const entry = finishing.value
    const repo = library.library()
    if (!entry || !repo || finishBusy.value) return null
    finishError.value = checkDay(endedOn.value, { notBefore: entry.latestSession?.startedOn })
    if (finishError.value) return null
    finishBusy.value = true
    try {
      const result = await repo.finish(entry.id, {
        endedOn: endedOn.value,
        rating: rating.value,
        review: review.value,
      })
      if (result.error) {
        finishError.value = result.error
        return null
      }
      library.entryChanged(result.data)
      finishing.value = null
      draftFor = null
      return result.data
    } finally {
      finishBusy.value = false
    }
  }

  function reset() {
    starting.value = null
    finishing.value = null
    startError.value = null
    finishError.value = null
    draftFor = null
  }

  const session = useSessionStore()
  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  return {
    starting,
    startedOn,
    startBusy,
    startError,
    openStart,
    closeStart,
    confirmStart,
    finishing,
    endedOn,
    rating,
    review,
    finishBusy,
    finishError,
    openFinish,
    closeFinish,
    confirmFinish,
    reset,
  }
})
