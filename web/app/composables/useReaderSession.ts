/**
 * The reader's persistence lifecycle (#131 phase 2), in one place: what the
 * component that draws the book should not have to hold itself.
 *
 * Four things move together while a book is open, and each of them is a small
 * machine of its own:
 *
 * - **The progress writer** (`data/reader/progress.ts`): the place becomes
 *   progress, forward only, after resting on it — and not for opening the book
 *   nor for a look-up (Contents, Search, the slider), only once the member reads
 *   on (`readsOn`).
 * - **The place**: the device's copy on every page (`leavePlace`'s dual write),
 *   the server's 5 s after the last turn and at once on closing.
 * - **The opening place and the opening highlights**: each waits at most 800 ms
 *   for the server, so the book never waits for the network.
 * - **The highlights**: drawn as the device's list says (and the server's, when
 *   it arrives), reconciled whenever that list changes, and read again every
 *   minute while the page is visible, when the app comes back to the
 *   foreground and when the connection returns (`followHighlights`).
 *
 * Closing writes what is left at once — `leavePlace(now: true)` and
 * `writer.flush()` — on the close, and on the component's unmount. A missed
 * flush loses a member's place, so those two calls are the one thing here that
 * must never be reordered behind a transition: `close()` does them before
 * anything animates, `release()` is what an unmounted reader runs.
 *
 * What is **not** here: the reader's gestures. The tap zones, the swipe and
 * the wheel policy, the overscroll pulls, the long press and the tap-suppress
 * timings stay in `components/reader/Reader.vue`, where the frames and the
 * pointer events are; the edge-tap regression there is the app's worst phone bug
 * and this composable has no business in it.
 *
 * The store (`stores/reader.ts`) keeps the records: settings, progress, the
 * places and the highlights; this only orders the calls. Everything it touches
 * comes in as an argument, so the lifecycle is legible (and a native reader can
 * follow it) without reading the component.
 */
import { readonly, ref, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import type { ProgressValue } from '~/data/progress'
import type { Highlight, Place } from '~/data/reader/device'
import { ProgressWriter } from '~/data/reader/progress'
import type { Relocation } from '~/data/reader/relocation'
import { withinServerWait } from '~/data/reader/session'

/** What the reader gives the session about the book it has open. */
export interface ReaderSessionOptions {
  entryId: () => string
  /** The fingerprint of the copy on this device: a CFI means something only in the file it was taken in. */
  fileHash: () => string
  /** What is saved for the entry now (the writer only moves it forward). */
  progressFor: () => ProgressValue | null
  /** The Book's page count, or null where there is none (progress is a percent then). */
  pageCount: () => number | null
  /** Only a read that is under way gets progress (Currently reading). */
  reading: () => boolean
  /** The Library's own progress path (`updateProgress`, the outbox while offline). */
  saveProgress: (value: ProgressValue) => void
  /** The newer of the device's place and the server's (the store asks the server; this bounds the wait). */
  openingPlaceFor: (entryId: string, fileHash: string) => Promise<{ cfi: string } | { fraction: number } | null>
  /** The device's place at once, the server's 5 s after the last turn (or now). */
  leavePlace: (entryId: string, place: Omit<Place, 'at'>, options?: { now?: boolean }) => void
  /** The device's highlights joined by the server's (the store reads; this bounds the wait). */
  openHighlights: (entryId: string, fileHash: string) => Promise<Highlight[]>
  /** Reads the highlights again every minute while visible, on foreground and on reconnect; returns how to stop. */
  followHighlights: (entryId: string, fileHash: string) => () => void
  /** What the page should draw for this copy, from the store's list. */
  highlightsFor: (entryId: string, fileHash: string) => Highlight[]
}

/** The engine's highlights, as the session reconciles and the component draws them. */
export interface ReaderSession {
  writer: ProgressWriter
  /** Where the reader is now (the engine's own relocation), as the chrome reads it. */
  loc: Readonly<Ref<Relocation | null>>
  /** The engine is open and the room is the member's: before that, nothing is written. */
  ready: Readonly<Ref<boolean>>
  /** The book has opened: from here the place counts, and the highlights are read again in the background. */
  open: () => void
  /** Where to open the book: the place, and the highlights it opens with, each bounded by `SERVER_WAIT_MS`. */
  opening: () => Promise<{ at: { cfi: string } | { fraction: number } | null; highlights: Highlight[] }>
  /**
   * The engine has moved: the place is written (device at once, server after a
   * rest), the writer decides whether that is progress, and the highlights the
   * device now holds are drawn or lifted.
   */
  onRelocate: (at: Relocation) => void
  /** The member reads on (a turn, a scroll): from here places count as progress. */
  readsOn: () => void
  /** A look-up (Contents, Search, the slider): places stop counting until she reads on. */
  lookingUp: () => void
  /** The highlights the page should draw for this copy, reconciled as they change. */
  highlights: ShallowRef<Highlight[]>
  /** Closing: what is left is written now (the progress and the place both), and the poll stops. */
  close: () => void
  /** Unmounting without a close (signed out, another route): the same writes, nothing more. */
  release: () => void
}

/**
 * The reader's persistence lifecycle for one open book. Call it from the
 * reader's `setup`, before the book opens; hand `open()` the engine's readiness.
 */
export function useReaderSession(options: ReaderSessionOptions): ReaderSession {
  const loc = ref<Relocation | null>(null)
  const ready = ref(false)
  const highlights = shallowRef<Highlight[]>([])

  const writer = new ProgressWriter({
    current: () => options.progressFor(),
    pageCount: () => options.pageCount(),
    enabled: () => options.reading(),
    write: (value) => options.saveProgress(value),
  })

  /** What leaving the book always does, once: the progress and the place written at once. */
  let flushed = false
  /** The server's highlights are being read again in the background (closed with the book). */
  let stopFollowing: (() => void) | null = null

  /**
   * The place, both ways round: the device's copy at once (every page), the
   * server's after a rest — and `now`, at once. Sent only once the book has
   * opened: the place the book opens at is not a turn.
   */
  function remember(at: Relocation) {
    if (!ready.value) return
    options.leavePlace(options.entryId(), { cfi: at.cfi, fraction: at.fraction, fileHash: options.fileHash() })
  }

  /**
   * What the page should draw: this copy's live highlights, from the device's
   * list (which the server's joins). Kept here so the component holds no
   * second copy of it and the reconciliation runs on a change, not on a draw.
   */
  function refreshHighlights() {
    highlights.value = options.highlightsFor(options.entryId(), options.fileHash())
  }

  /** The device's own answer, which the page shows while the server's is still on its way. */
  function fromDevice() {
    refreshHighlights()
    return highlights.value
  }

  /**
   * What the book opens with: its place and its highlights, read in parallel and
   * each given `SERVER_WAIT_MS` — a server that does not answer in time leaves
   * the device's own answer to open the book, and nothing waits for it after.
   * A read that fails or is late still lands in the store while she reads on,
   * and the page is told through `highlights`.
   */
  function opening(): Promise<{ at: { cfi: string } | { fraction: number } | null; highlights: Highlight[] }> {
    const place = options.openingPlaceFor(options.entryId(), options.fileHash()).catch(() => null)
    const highlights = options.openHighlights(options.entryId(), options.fileHash()).catch(() => null)
    const arrived = Promise.all([place, highlights]).then(([at, list]) => ({ at, highlights: list ?? fromDevice() }))
    return withinServerWait(arrived, { at: null, highlights: fromDevice() })
  }

  // The device's list is the page's list: whenever it changes (a highlight made, removed, or one the server brought
  // in while the book is open) the page is told, and it draws or lifts what it has to.
  watch(() => options.highlightsFor(options.entryId(), options.fileHash()), refreshHighlights, { deep: false })

  function open() {
    ready.value = true
    refreshHighlights()
    if (!stopFollowing && !flushed) stopFollowing = options.followHighlights(options.entryId(), options.fileHash())
  }

  function onRelocate(at: Relocation) {
    loc.value = at
    writer.saw(at.fraction)
    remember(at)
  }

  function readsOn() {
    writer.reading()
  }

  function lookingUp() {
    writer.lookingUp()
  }

  /** The progress and the place written at once, and the poll stopped — the reason this module exists. */
  function flush() {
    if (flushed) return
    flushed = true
    writer.flush()
    const at = loc.value
    if (at) options.leavePlace(options.entryId(), { cfi: at.cfi, fraction: at.fraction, fileHash: options.fileHash() }, { now: true })
    stopFollowing?.()
    stopFollowing = null
  }

  return {
    writer,
    loc: readonly(loc),
    ready: readonly(ready),
    opening,
    open,
    onRelocate,
    readsOn,
    lookingUp,
    highlights,
    /** Closing the book: what is left is written now, before anything animates away. */
    close: flush,
    /** Unmounted (signed out, another route): the same writes, and the writer gives up its timer. */
    release: () => {
      flush()
      writer.dispose()
    },
  }
}
