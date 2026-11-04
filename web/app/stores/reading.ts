import { defineStore } from 'pinia'
import { isNotFinished, type LibraryEntry, type LibraryErrorCode } from '~/data/library'
import {
  convertProgress,
  NO_PROGRESS,
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
import { dayBoundsOf, type DayBounds } from '~/data/progressDays'
import type { ReadAs } from '~/data/readAs'
import { isoDay } from '~/utils/dates'
import { useLibraryStore } from '~/stores/library'
import { useProgressDaysStore, type DayOp } from '~/stores/progressDays'
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
  const progressDays = useProgressDaysStore()

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
  /** "Contains spoilers" (social v2a): sent with the review only; off for each new draft. */
  const reviewSpoilers = ref(false)
  // The flag goes with the review: emptied, it is off again (its switch is hidden then).
  watch(review, (text) => {
    if (!text.trim()) reviewSpoilers.value = false
  })
  /** How she read it (issue #169): her word as the sheet shows it; null = not said (the edition's default counts). */
  const finishReadAs = ref<ReadAs | null>(null)
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
    reviewSpoilers.value = false
    finishReadAs.value = entry.readAs ?? null
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
        reviewSpoilers: reviewSpoilers.value,
      })
      if (result.error) {
        finishError.value = result.error
        return null
      }
      library.entryChanged(result.data)
      // Her word on how she read it goes along when it changed (it needs the connection; the finish itself waits for one).
      if (isOnline() && finishReadAs.value !== (entry.readAs ?? null)) await library.setReadAs(result.data, finishReadAs.value)
      finishing.value = null
      draftFor = null
      return library.entryById(result.data.id) ?? result.data
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
  /**
   * The day the sheet is about (`YYYY-MM-DD`, an earlier day: progress on a day she forgot to update); null is Today,
   * the sheet as it has always been. An earlier day is bounded by its neighbours (`progressBounds`) and saved with
   * `set_progress_day`; Today stays `update_progress`.
   */
  const progressDay = ref<string | null>(null)
  /** The sheet was opened on an earlier day before its read's days were loaded: the wheel is seeded when they are. */
  let progressSeedPending = false

  const progressEditionCount = computed(() => progressing.value?.book.pageCount ?? null)
  /** The page count that counts while the sheet is open: her total as set in it, else the edition's. */
  const progressPageCount = computed(() => progressTotal.value ?? progressEditionCount.value)
  /** The most a number in the wheel's mode takes: the page count in pages, 100 in percent. */
  const progressCeiling = computed(() => progressMax(progressMode.value, progressPageCount.value))
  /** The open read's days (with the writes that wait laid over them), null until they are loaded. */
  const progressDaysOfRead = computed(() => {
    const id = progressing.value?.latestSession?.id
    return id ? (progressDays.shown[id] ?? null) : null
  })
  /**
   * Where the wheel may stand on an earlier day, in the wheel's mode (`dayBoundsOf`: between the neighbouring days,
   * the day's start and where it ends now). Null for Today (free), and while the read's days are not loaded: the
   * bounds are unknown then, and the sheet does not offer a day.
   */
  const progressBounds = computed<DayBounds | null>(() => {
    const entry = progressing.value
    const days = progressDaysOfRead.value
    if (!entry || !progressDay.value || !days) return null
    return dayBoundsOf(days, progressDay.value, progressOf(entry.latestSession), pageCountOf(entry), progressMode.value)
  })
  /** The least the wheel takes: where the day before ended on an earlier day, 0 on Today. */
  const progressFloor = computed(() => progressBounds.value?.lo ?? 0)
  /** The most the wheel takes: the page count in pages, 100 in percent; on an earlier day, where the day after ended. */
  const progressLimit = computed(() =>
    progressBounds.value ? Math.min(progressCeiling.value, progressBounds.value.hi) : progressCeiling.value,
  )
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

  /** The wheel on the day: where it ended when it has a row, else where the day before ended (nothing yet). */
  function seedProgressDay() {
    const bounds = progressBounds.value
    if (!bounds) return
    progressValue.value = bounds.end ?? bounds.lo
  }

  /**
   * Opens the sheet on the entry's progress; `total` opens it on her total pages (the book page's "of 608"); `day`
   * opens it on that earlier day (the log's rows and its Add day), the wheel on where it ended, else where the day
   * before did. Without the read's days (not loaded yet) the wheel is seeded when they arrive.
   */
  function openProgress(entry: LibraryEntry, { day, total = false }: { day?: string; total?: boolean } = {}) {
    const current = progressOf(entry.latestSession)
    progressing.value = entry
    progressTotal.value = entry.pageCountOverride ?? null
    progressMode.value = progressModeFor({ pageCount: pageCountOf(entry) }, current)
    progressValue.value = progressIn(current, progressMode.value, pageCountOf(entry))
    progressEditing.value = 'progress'
    progressError.value = null
    progressDay.value = day ?? null
    progressSeedPending = false
    if (day) {
      progressDays.want(entry.latestSession?.id)
      if (progressBounds.value) seedProgressDay()
      else progressSeedPending = true
      return
    }
    if (total) editProgressTotal()
  }

  /**
   * Switches the sheet between Today (null) and an earlier day: the wheel goes to where that day ended, else where
   * the day before did (the day's "nothing yet"); back to Today, to the read's value. The refusal of a day before goes.
   */
  function chooseProgressDay(day: string | null) {
    const entry = progressing.value
    if (!entry || day === progressDay.value) return
    progressDay.value = day
    progressError.value = null
    progressEditing.value = 'progress'
    progressSeedPending = false
    if (!day) {
      progressValue.value = progressIn(progressStored.value, progressMode.value, progressPageCount.value)
      return
    }
    if (progressBounds.value) seedProgressDay()
    else {
      progressDays.want(entry.latestSession?.id)
      progressSeedPending = true
    }
  }

  // An earlier day opened before the days were there: the wheel goes to its place once they are.
  watch(progressBounds, (bounds) => {
    if (!bounds || !progressSeedPending) return
    progressSeedPending = false
    seedProgressDay()
  })

  function closeProgress() {
    if (!progressBusy.value) progressing.value = null
    progressSeedPending = false
  }

  /** Switches between pages and percent, carrying the place in the book over. */
  function chooseProgressMode(mode: ProgressMode) {
    if (mode === progressMode.value || (mode === 'page' && !progressPageCount.value)) return
    progressValue.value = convertProgress(progressValue.value, mode, progressPageCount.value)
    progressMode.value = mode
    progressError.value = null
    // An earlier day stays inside its neighbours: the number converted may sit a unit outside them (rounding).
    if (progressBounds.value) progressValue.value = Math.min(Math.max(progressValue.value, progressFloor.value), progressLimit.value)
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
    if (progressDay.value) return confirmProgressDay(entry, repo)
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
      const result = await repo.updateProgress(entry.id, value, totalChanged ? { pageCount: progressTotal.value } : undefined, isoDay())
      if (result.error) {
        progressError.value = result.error
        return null
      }
      library.entryChanged(result.data)
      progressDays.refresh(result.data.latestSession?.id)
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
   * What an earlier day's save or Remove leaves behind, once the database (or the outbox) has taken it: the entry
   * shown as it came back, always (Profile's record and the figures read again on `entryChanged`, even when the entry
   * is unchanged: a day in the middle moves no value), the read's days asked for again, the write that waits laid
   * over them, and Home's Undo forgotten (it would put back a value from before this day).
   */
  function dayWritten(entry: LibraryEntry, op: DayOp, result: LibraryEntry) {
    progressDays.hold(entry, op)
    library.entryChanged(result)
    progressDays.refresh(result.latestSession?.id ?? entry.latestSession?.id)
    progressing.value = null
    forgetUndo()
  }

  /** Save on an earlier day: where she ended it, through `set_progress_day`; nothing new just closes the sheet. */
  async function confirmProgressDay(entry: LibraryEntry, repo: NonNullable<ReturnType<typeof library.library>>): Promise<LibraryEntry | null> {
    const day = progressDay.value!
    const bounds = progressBounds.value
    // Nothing new: the day ends where it does, or (no row) where it began (a day that reads nothing has no row).
    if (bounds && progressValue.value === (bounds.end ?? bounds.lo)) {
      progressing.value = null
      return entry
    }
    const value = progressValueOf(progressValue.value, progressMode.value)
    progressBusy.value = true
    progressError.value = null
    try {
      const result = await repo.setProgressDay(entry.id, day, value)
      if (result.error) {
        progressError.value = result.error
        return null
      }
      dayWritten(entry, { day, value }, result.data)
      return result.data
    } finally {
      progressBusy.value = false
    }
  }

  /**
   * Remove this day (after the confirm): its row goes and the next day absorbs its pages; when it was the latest day
   * her progress goes back to where it began (the confirm says so). Same failure and waiting as a save. Returns the
   * entry, or null with `progressError` set.
   */
  async function removeProgressDay(): Promise<LibraryEntry | null> {
    const entry = progressing.value
    const day = progressDay.value
    const repo = library.library()
    if (!entry || !day || !repo || progressBusy.value) return null
    progressBusy.value = true
    progressError.value = null
    try {
      const result = await repo.deleteProgressDay(entry.id, day)
      if (result.error) {
        progressError.value = result.error
        return null
      }
      dayWritten(entry, { day, value: null }, result.data)
      return result.data
    } finally {
      progressBusy.value = false
    }
  }

  /**
   * Undo on Home's card: the value (and her total, when the save changed it) as they
   * were, in one call. A read that had none goes back to none (`NO_PROGRESS`, #104): the
   * database clears the value. Returns the entry, or null.
   */
  async function undoProgress(): Promise<LibraryEntry | null> {
    const undo = progressUndo.value
    const repo = library.library()
    if (!undo || !repo || undoBusy.value) return null
    // A read that had none goes back to none, not to 0 (#104).
    const back = undo.before ?? NO_PROGRESS
    undoBusy.value = true
    try {
      const result = await repo.updateProgress(undo.entryId, back, undo.totalChanged ? { pageCount: undo.beforeTotal } : undefined, isoDay())
      if (result.error) return null
      library.entryChanged(result.data)
      progressDays.refresh(result.data.latestSession?.id)
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
    // Finish ends the read today: an earlier day's sheet does not offer it.
    if (progressDay.value) return null
    if (progressEditing.value === 'total') confirmProgressTotal()
    const entry = await confirmProgress()
    if (entry) openFinish(entry)
    return entry
  }

  /**
   * DNF in the sheet, Finish's twin: the progress is saved the same way (an abandoned
   * read keeps it too: where she put it down), then the DNF sheet takes over, and the
   * read ends there exactly as it always has (`confirmAbandon`).
   */
  async function abandonFromProgress(): Promise<LibraryEntry | null> {
    if (progressDay.value) return null
    if (progressEditing.value === 'total') confirmProgressTotal()
    const entry = await confirmProgress()
    if (entry) openAbandon(entry)
    return entry
  }

  function reset() {
    progressing.value = null
    progressDay.value = null
    progressSeedPending = false
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
    reviewSpoilers,
    finishReadAs,
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
    progressDay,
    progressBounds,
    progressFloor,
    progressLimit,
    progressFrom,
    progressDelta,
    progressAtEnd,
    openProgress,
    chooseProgressDay,
    closeProgress,
    chooseProgressMode,
    editProgressTotal,
    confirmProgressTotal,
    dropProgressTotal,
    confirmProgress,
    removeProgressDay,
    progressUndo,
    undoBusy,
    undoProgress,
    finishFromProgress,
    abandonFromProgress,
    reset,
  }
})
