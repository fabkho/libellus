import { defineStore } from 'pinia'
import { isNotFinished, type LibraryEntry, type LibraryErrorCode } from '~/data/library'
import {
  convertProgressField,
  parseProgress,
  progressFieldOf,
  progressMax,
  progressModeFor,
  progressOf,
  progressReachedEnd,
  type ProgressMode,
} from '~/data/progress'
import { isoDay } from '~/utils/dates'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

/**
 * The Start, Finish, Abandon and Update progress sheets (issues #7, #10, #39): which entry each is
 * about, what the member has chosen so far, and the action's progress. The
 * Start sheet also reads a closed Book again (`startKind`). Each action is one call
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
  /**
   * What the Start sheet does for it: the first read (`start`), the next read
   * of a Book that was finished (`again`) or of one that was abandoned
   * (`restart`). The same day row and button; only the database call and the
   * words differ.
   */
  const startKind = computed<'start' | 'again' | 'restart'>(() => {
    const entry = starting.value
    if (!entry || entry.status !== 'finished') return 'start'
    return isNotFinished(entry) ? 'restart' : 'again'
  })
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

  /**
   * Starts the read: `start_reading` for the first one, `read_again` when the
   * Book has been read before (the database refuses the wrong one). Returns
   * the entry, now Currently reading, or null with `startError` set.
   */
  async function confirmStart(): Promise<LibraryEntry | null> {
    const entry = starting.value
    const repo = library.library()
    if (!entry || !repo || startBusy.value) return null
    startError.value = checkDay(startedOn.value)
    if (startError.value) return null
    startBusy.value = true
    try {
      const result =
        startKind.value === 'start'
          ? await repo.startReading(entry.id, startedOn.value)
          : await repo.readAgain(entry.id, startedOn.value)
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

  // ----------------------------------------------------------------- Abandon

  /** The entry the Abandon sheet is about; null while it is closed. */
  const abandoning = ref<LibraryEntry | null>(null)
  const abandonedOn = ref('')
  const reason = ref('')
  const abandonBusy = ref(false)
  const abandonError = ref<LibraryErrorCode | null>(null)
  /** The entry the choices above were made for: reopening its sheet keeps them. */
  let abandonDraftFor: string | null = null

  function openAbandon(entry: LibraryEntry) {
    abandoning.value = entry
    abandonError.value = null
    if (abandonDraftFor === entry.id) return
    abandonDraftFor = entry.id
    abandonedOn.value = isoDay()
    reason.value = ''
  }

  function closeAbandon() {
    if (!abandonBusy.value) abandoning.value = null
  }

  /** Abandons the read. Returns the entry, now Finished (not finished), or null with `abandonError` set. */
  async function confirmAbandon(): Promise<LibraryEntry | null> {
    const entry = abandoning.value
    const repo = library.library()
    if (!entry || !repo || abandonBusy.value) return null
    abandonError.value = checkDay(abandonedOn.value, { notBefore: entry.latestSession?.startedOn })
    if (abandonError.value) return null
    abandonBusy.value = true
    try {
      const result = await repo.abandon(entry.id, { endedOn: abandonedOn.value, reason: reason.value })
      if (result.error) {
        abandonError.value = result.error
        return null
      }
      library.entryChanged(result.data)
      abandoning.value = null
      abandonDraftFor = null
      return result.data
    } finally {
      abandonBusy.value = false
    }
  }

  // ---------------------------------------------------------------- Progress

  /** The entry the Update progress sheet is about; null while it is closed. */
  const progressing = ref<LibraryEntry | null>(null)
  /** Whether the field is a page or a percent (pages only for a Book with a page count). */
  const progressMode = ref<ProgressMode>('percent')
  /** What the member typed: digits, or '' for nothing yet. */
  const progressField = ref('')
  const progressBusy = ref(false)
  const progressError = ref<LibraryErrorCode | null>(null)

  const progressPageCount = computed(() => progressing.value?.book.pageCount ?? null)
  /** The most the field takes: the page count in pages, 100 in percent. */
  const progressLimit = computed(() => progressMax(progressMode.value, progressPageCount.value))
  /** The field is a number the database takes; null while it is not. */
  const progressValue = computed(() => parseProgress(progressField.value, progressMode.value, progressPageCount.value).value)
  /** The field is at the last page (or 100 %): the sheet offers "Finished it?". */
  const progressAtEnd = computed(() => progressReachedEnd(progressValue.value, progressPageCount.value))

  function openProgress(entry: LibraryEntry) {
    const current = progressOf(entry.latestSession)
    progressing.value = entry
    progressMode.value = progressModeFor(entry.book, current)
    progressField.value = progressFieldOf(current, progressMode.value)
    progressError.value = null
  }

  function closeProgress() {
    if (!progressBusy.value) progressing.value = null
  }

  /** Switches between pages and percent, carrying the place in the book over. */
  function chooseProgressMode(mode: ProgressMode) {
    if (mode === progressMode.value || !progressPageCount.value) return
    progressField.value = convertProgressField(progressField.value, mode, progressPageCount.value)
    progressMode.value = mode
    progressError.value = null
  }

  /** The quick buttons: adds to what is typed (nothing typed is 0), never past the limit. */
  function bumpProgress(by: number) {
    const typed = Number(progressField.value.trim())
    const now = Number.isFinite(typed) ? typed : 0
    progressField.value = String(Math.min(progressLimit.value, now + by))
    progressError.value = null
  }

  /** Sends the field as the entry's progress. Returns the entry, or null with `progressError` set. */
  async function confirmProgress(): Promise<LibraryEntry | null> {
    const entry = progressing.value
    const repo = library.library()
    if (!entry || !repo || progressBusy.value) return null
    const parsed = parseProgress(progressField.value, progressMode.value, progressPageCount.value)
    if (!parsed.value) {
      progressError.value = parsed.error
      return null
    }
    progressBusy.value = true
    try {
      const result = await repo.updateProgress(entry.id, parsed.value)
      if (result.error) {
        progressError.value = result.error
        return null
      }
      library.entryChanged(result.data)
      progressing.value = null
      return result.data
    } finally {
      progressBusy.value = false
    }
  }

  /**
   * "Finished it?": the last page is reached, so the progress is saved (a
   * finished read keeps it) and the Finish sheet takes over from this one.
   */
  async function finishFromProgress(): Promise<LibraryEntry | null> {
    const entry = await confirmProgress()
    if (entry) openFinish(entry)
    return entry
  }

  function reset() {
    progressing.value = null
    progressError.value = null
    starting.value = null
    finishing.value = null
    abandoning.value = null
    startError.value = null
    finishError.value = null
    abandonError.value = null
    draftFor = null
    abandonDraftFor = null
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
    startKind,
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
    abandoning,
    abandonedOn,
    reason,
    abandonBusy,
    abandonError,
    openAbandon,
    closeAbandon,
    confirmAbandon,
    progressing,
    progressMode,
    progressField,
    progressBusy,
    progressError,
    progressLimit,
    progressAtEnd,
    openProgress,
    closeProgress,
    chooseProgressMode,
    bumpProgress,
    confirmProgress,
    finishFromProgress,
    reset,
  }
})
