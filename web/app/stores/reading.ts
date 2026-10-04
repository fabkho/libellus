import { defineStore } from 'pinia'
import { isNotFinished, type LibraryEntry, type LibraryErrorCode } from '~/data/library'
import {
  convertProgress,
  ownTotal,
  pageCountOf,
  progressGain,
  progressIn,
  progressMax,
  progressModeFor,
  progressOf,
  progressReachedEnd,
  progressValueOf,
  sameProgress,
  TOTAL_GUESS,
  type ProgressMode,
  type ProgressValue,
} from '~/data/progress'
import { isoDay } from '~/utils/dates'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

/** How long Home's card offers Undo after a progress save, ms (issue #68). */
export const UNDO_MS = 5000

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
  /** Whether the wheel is a page or a percent (pages only with a page count). */
  const progressMode = ref<ProgressMode>('percent')
  /** The wheel's number (issue #68): the page, or the percent. */
  const progressValue = ref(0)
  /**
   * Her own total pages for the entry as the sheet has it (issue #60); null is none,
   * the edition's page count counts. Changed on the total wheel, sent with the save.
   */
  const progressTotal = ref<number | null>(null)
  /** What the wheel sets: the progress, or (after "of 608") the total pages. */
  const progressEditing = ref<'progress' | 'total'>('progress')
  /** The total wheel's number while it is the one showing. */
  const progressTotalDraft = ref(TOTAL_GUESS)
  const progressBusy = ref(false)
  const progressError = ref<LibraryErrorCode | null>(null)

  const progressEditionCount = computed(() => progressing.value?.book.pageCount ?? null)
  /** The page count that counts while the sheet is open: her total as set in it, else the edition's. */
  const progressPageCount = computed(() => progressTotal.value ?? progressEditionCount.value)
  /** The most the wheel takes: the page count in pages, 100 in percent. */
  const progressLimit = computed(() => progressMax(progressMode.value, progressPageCount.value))
  /** What is stored for the open read, null while none is. */
  const progressStored = computed(() => progressOf(progressing.value?.latestSession))
  /** Where the read is, in the wheel's mode: what the save is measured against. */
  const progressFrom = computed(() => progressIn(progressStored.value, progressMode.value, progressPageCount.value))
  /** How far the wheel has moved from it ("+24"). */
  const progressDelta = computed(() => progressValue.value - progressFrom.value)
  /** The wheel is at the last page (or 100 %): the sheet says so beside Finish. */
  const progressAtEnd = computed(() =>
    progressReachedEnd(progressValueOf(progressValue.value, progressMode.value), progressPageCount.value),
  )

  function openProgress(entry: LibraryEntry) {
    const current = progressOf(entry.latestSession)
    progressing.value = entry
    progressTotal.value = entry.pageCountOverride ?? null
    progressMode.value = progressModeFor({ pageCount: pageCountOf(entry) }, current)
    progressValue.value = progressIn(current, progressMode.value, pageCountOf(entry))
    progressEditing.value = 'progress'
    progressError.value = null
  }

  function closeProgress() {
    if (!progressBusy.value) progressing.value = null
  }

  /** Switches between pages and percent, carrying the place in the book over. */
  function chooseProgressMode(mode: ProgressMode) {
    if (mode === progressMode.value || (mode === 'page' && !progressPageCount.value)) return
    progressValue.value = convertProgress(progressValue.value, mode, progressPageCount.value)
    progressMode.value = mode
    progressError.value = null
  }

  /** "of 608 ✎" (or "Count in pages" without a page count): the wheel sets the total pages instead. */
  function editProgressTotal() {
    progressTotalDraft.value = progressPageCount.value ?? TOTAL_GUESS
    progressEditing.value = 'total'
    progressError.value = null
  }

  /**
   * Done on the total wheel: it is her total from now on (the edition's own count is
   * none), and the wheel counts pages against it. A percent becomes the page it is of
   * the new total; a page past it becomes its last page. Saved with the progress.
   */
  function confirmProgressTotal() {
    const total = progressTotalDraft.value
    if (progressMode.value === 'percent') progressValue.value = convertProgress(progressValue.value, 'page', total)
    else progressValue.value = Math.min(progressValue.value, total)
    progressTotal.value = ownTotal(total, progressEditionCount.value)
    progressMode.value = 'page'
    progressEditing.value = 'progress'
  }

  /**
   * Back to the edition's page count ("Edition's 592"); a Book without one goes back
   * to counting in percent ("Use percent"), the page carried over through her total.
   */
  function dropProgressTotal() {
    const edition = progressEditionCount.value
    if (edition) progressValue.value = Math.min(progressValue.value, edition)
    else {
      progressValue.value = progressMode.value === 'page' ? convertProgress(progressValue.value, 'percent', progressPageCount.value) : progressValue.value
      progressMode.value = 'percent'
    }
    progressTotal.value = null
    progressEditing.value = 'progress'
  }

  /** The last save, for a moment (Home's card offers "+24" and Undo). */
  const progressUndo = ref<{
    entryId: string
    /** What was there before: the value (null: none) and her own total. */
    before: ProgressValue | null
    beforeTotal: number | null
    /** The total that was sent with the save, so Undo knows to send the old one back. */
    totalChanged: boolean
    after: ProgressValue
    gain: { amount: number; unit: ProgressMode } | null
  } | null>(null)
  const undoBusy = ref(false)
  let undoTimer: ReturnType<typeof setTimeout> | undefined
  function forgetUndo() {
    clearTimeout(undoTimer)
    progressUndo.value = null
  }

  /**
   * Sends the wheel as the entry's progress, with her total when it changed, in one
   * call. Nothing changed: the sheet just closes. Returns the entry, or null with
   * `progressError` set.
   */
  async function confirmProgress(): Promise<LibraryEntry | null> {
    const entry = progressing.value
    const repo = library.library()
    if (!entry || !repo || progressBusy.value) return null
    if (progressEditing.value === 'total') {
      confirmProgressTotal()
      return null
    }
    const value = progressValueOf(progressValue.value, progressMode.value)
    const before = progressStored.value
    const beforeTotal = entry.pageCountOverride ?? null
    const totalChanged = progressTotal.value !== beforeTotal
    // Nothing new: none stays none at 0, and the same value is not saved again.
    if (!totalChanged && (sameProgress(before, value) || (!before && progressValue.value === 0))) {
      progressing.value = null
      return entry
    }
    progressBusy.value = true
    progressError.value = null
    try {
      const result = await repo.updateProgress(entry.id, value, totalChanged ? { pageCount: progressTotal.value } : undefined)
      if (result.error) {
        progressError.value = result.error
        return null
      }
      library.entryChanged(result.data)
      progressing.value = null
      forgetUndo()
      progressUndo.value = { entryId: entry.id, before, beforeTotal, totalChanged, after: value, gain: progressGain(before, value, progressPageCount.value) }
      undoTimer = setTimeout(forgetUndo, UNDO_MS)
      return result.data
    } finally {
      progressBusy.value = false
    }
  }

  /**
   * Undo on Home's card: the value (and her total, when the save changed it) as they
   * were, in one call. A read that had none goes back to 0, in the unit it was saved
   * in: the database keeps a value once there is one. Returns the entry, or null.
   */
  async function undoProgress(): Promise<LibraryEntry | null> {
    const undo = progressUndo.value
    const repo = library.library()
    if (!undo || !repo || undoBusy.value) return null
    const back = undo.before ?? progressValueOf(0, 'page' in undo.after ? 'page' : 'percent')
    undoBusy.value = true
    try {
      const result = await repo.updateProgress(undo.entryId, back, undo.totalChanged ? { pageCount: undo.beforeTotal } : undefined)
      if (result.error) return null
      library.entryChanged(result.data)
      forgetUndo()
      return result.data
    } finally {
      undoBusy.value = false
    }
  }

  /**
   * Finish in the sheet: the progress is saved (a finished read keeps it), then
   * the Finish sheet takes over from this one.
   */
  async function finishFromProgress(): Promise<LibraryEntry | null> {
    if (progressEditing.value === 'total') confirmProgressTotal()
    const entry = await confirmProgress()
    if (entry) openFinish(entry)
    return entry
  }

  function reset() {
    progressing.value = null
    progressError.value = null
    forgetUndo()
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
    progressValue,
    progressTotal,
    progressEditing,
    progressTotalDraft,
    progressBusy,
    progressError,
    progressEditionCount,
    progressPageCount,
    progressLimit,
    progressFrom,
    progressDelta,
    progressAtEnd,
    openProgress,
    closeProgress,
    chooseProgressMode,
    editProgressTotal,
    confirmProgressTotal,
    dropProgressTotal,
    confirmProgress,
    progressUndo,
    undoBusy,
    undoProgress,
    finishFromProgress,
    reset,
  }
})
