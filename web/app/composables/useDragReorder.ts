import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Hold-to-lift, drag-to-reorder for a list of fixed blocks (the Collection's rows; docs/parity.md,
 * "Drag a row's grip", and docs/MOTION.md, "Follow the finger": the row follows the finger 1:1, the
 * others glide out of its way over `quick`, and letting go glides it into its place).
 *
 * The finger's physics live here, away from the screen that draws the rows: what the rows are, what a
 * move means and what it is called in her language are all the screen's (this composable holds no
 * store, no copy and no `t`), so the three pure functions below are driven in plain Node
 * (`tests/drag-reorder.test.ts`) and the whole gesture is one file to read.
 *
 * Everything the gesture starts — the hold timer, the window's pointer listeners, the auto-scroll
 * frame, the settle timer — is cancelled in one `onBeforeUnmount`.
 */

/** A row as it was laid out when the drag began, in page coordinates (so scrolling counts). */
export type DragRow = { top: number; height: number }

/** How long a still finger takes to lift a row, ms (docs/parity.md: 350). */
const HOLD_MS = 350
/** How far a finger may travel before a hold is a scroll instead, px. */
const HOLD_SLOP = 8
/** How far the page scrolls itself per frame near the edge, px. */
const SCROLL_STEP = 8
/** The default `--size-touch`, for a stylesheet that has none. */
const TOUCH_FALLBACK = 44

/**
 * Where a row lifted at `index` would land, from the centre of the row under the finger: one place
 * down for every row whose own centre it has passed. The row being moved never counts itself.
 */
export function targetFor(rows: readonly DragRow[], index: number, centerY: number): number {
  if (!rows.length) return index
  let target = 0
  rows.forEach((row, j) => {
    if (j !== index && row.top + row.height / 2 < centerY) target++
  })
  return target
}

/**
 * How far the lifted row may travel: it stays within the list, its top at the first row's and its
 * bottom at the last one's, however far the finger goes.
 */
export function clampDy(rows: readonly DragRow[], index: number, dy: number): number {
  const own = rows[index]
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (!own || !first || !last) return 0
  const min = first.top - own.top
  const max = last.top + last.height - own.height - own.top
  return Math.min(max, Math.max(min, dy))
}

/**
 * Every row's offset from its own place while a row moved from `from` to `to`: the lifted row sits at
 * `dy` (where the finger has taken it, or, once she has let go, where it lands), and the rows it
 * passed take the room it needs — up by its height going down, down by it coming up.
 */
export function offsetsFor(rows: readonly DragRow[], from: number, to: number, dy: number): number[] {
  const height = rows[from]?.height ?? 0
  return rows.map((_row, index) => {
    if (index === from) return dy
    if (to > from && index > from && index <= to) return -height
    if (to < from && index >= to && index < from) return height
    return 0
  })
}

/** The row under the finger, from the moment it lifted until the move has landed. */
export type Drag = {
  index: number
  /** The words of the Book she lifted: said when it lands (the row at `index` may be another Book by then). */
  title: string
  pointerId: number
  /** Where the finger went down, in page coordinates (so scrolling counts). */
  startY: number
  lastClientY: number
  /** Each row's top and height in page coordinates, as laid out when the drag began. */
  rows: DragRow[]
  target: number
  dy: number
}

export type DragReorderOptions = {
  /** How many rows there are. */
  count: () => number
  /** Every row's top and height, in page coordinates, as they are laid out now (read once, at the lift). */
  rows: () => readonly DragRow[]
  /** Whether a row may be lifted at all (a Collection shown sorted has nothing to move). */
  canLift: () => boolean
  /** The move she made real: this one place to that one. The screen saves it; this never does. */
  onCommit: (from: number, to: number) => void
  /** Says a message in the screen's live region. */
  announce: (message: string) => void
  /** The words of the Book at a row, for the announcements. */
  title: (index: number) => string
  msgs: { lifted: (title: string) => string; moved: (title: string, from: number, to: number) => string; dropped: string }
  holdMs?: number
  holdSlop?: number
}

export function useDragReorder(options: DragReorderOptions) {
  const holdMs = options.holdMs ?? HOLD_MS
  const holdSlop = options.holdSlop ?? HOLD_SLOP

  const drag = ref<Drag | null>(null)
  /** The lifted row gliding into its new place after the finger let go. */
  const settling = ref(false)
  /** For one frame after a move lands: no transitions, so nothing slides back. */
  const still = ref(false)

  /** The finger that is holding a row down, waiting for the hold to become a lift. */
  let hold: { timer: number; pointerId: number; x: number; y: number } | null = null
  /** Set when a hold lifted a row, so the tap that ends it does not open the book page. */
  let swallowClick = false
  let frame = 0
  let settleTimer = 0

  // ------------------------------------------------------------------- lift

  function lift(element: HTMLElement, pointerId: number, clientY: number, index: number) {
    if (!options.canLift() || index < 0 || index >= options.count()) return
    const title = options.title(index)
    const rows = [...options.rows()]
    try {
      element.setPointerCapture(pointerId)
    } catch {
      // The pointer is gone already (lifted by a hold whose finger just left): nothing to drag.
      return
    }
    drag.value = {
      index,
      title,
      pointerId,
      startY: clientY + window.scrollY,
      lastClientY: clientY,
      rows,
      target: index,
      dy: 0,
    }
    navigator.vibrate?.(10)
    options.announce(options.msgs.lifted(title))
    autoScroll()
  }

  /** The grip lifts its row at once, for a mouse and a finger alike. */
  function gripDown(event: PointerEvent, index: number) {
    if (event.button !== 0 || drag.value || settling.value || !options.canLift()) return
    event.preventDefault()
    event.stopPropagation()
    swallowClick = false
    cancelHold()
    lift(event.currentTarget as HTMLElement, event.pointerId, event.clientY, index)
  }

  // Anywhere else on a row, a finger that holds still lifts it (D: "hold a row
  // to move it"); one that moves first is scrolling, and a quick tap opens the
  // book page as before. The mouse keeps to the grip.
  function rowDown(event: PointerEvent, index: number) {
    swallowClick = false
    if (event.pointerType === 'mouse' || drag.value || settling.value || !options.canLift()) return
    cancelHold()
    const element = event.currentTarget as HTMLElement
    const { pointerId, clientX, clientY } = event
    hold = {
      pointerId,
      x: clientX,
      y: clientY,
      timer: window.setTimeout(() => {
        hold = null
        lift(element, pointerId, clientY, index)
        swallowClick = Boolean(drag.value)
      }, holdMs),
    }
  }

  function cancelHold() {
    if (hold) window.clearTimeout(hold.timer)
    hold = null
  }

  // ---------------------------------------------------------------- the finger

  /**
   * Where the lifted row is, from the finger's height: the row follows it 1:1 (the difference is in
   * page coordinates, so a page that scrolled meanwhile counts), within the list, and the place it
   * would land follows the centre of the row.
   */
  function follow(clientY: number) {
    const current = drag.value
    if (!current) return
    current.lastClientY = clientY
    const own = current.rows[current.index]
    if (!own) return
    current.dy = clampDy(current.rows, current.index, clientY + window.scrollY - current.startY)
    current.target = targetFor(current.rows, current.index, own.top + current.dy + own.height / 2)
  }

  /**
   * Where the lifted row lands once she lets go: over the rows it passed, their heights added up.
   * It glides there over `quick` (`settling`), and the move is made real when it arrives.
   */
  function settledOffset(current: Drag): number {
    const { rows, index, target } = current
    if (target === index) return 0
    const passed = target > index ? rows.slice(index + 1, target + 1) : rows.slice(target, index)
    const span = passed.reduce((sum, row) => sum + row.height, 0)
    return target > index ? span : -span
  }

  /**
   * The window's pointer listeners: a finger that leaves the row (or the hold that never captured it)
   * still ends what it started.
   */
  function move(event: PointerEvent) {
    if (hold && hold.pointerId === event.pointerId) {
      if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > holdSlop) cancelHold()
      return
    }
    if (drag.value?.pointerId === event.pointerId) follow(event.clientY)
  }

  function up(event: PointerEvent) {
    if (hold?.pointerId === event.pointerId) cancelHold()
    const current = drag.value
    if (!current || current.pointerId !== event.pointerId || settling.value) return
    cancelAnimationFrame(frame)
    settling.value = true
    // Let the row glide into its place, then make the move real.
    current.dy = settledOffset(current)
    settleTimer = window.setTimeout(() => land(current), durationOf('--duration-quick'))
  }

  function cancel(event: PointerEvent) {
    if (hold?.pointerId === event.pointerId) cancelHold()
    const current = drag.value
    if (!current || current.pointerId !== event.pointerId || settling.value) return
    cancelAnimationFrame(frame)
    // The gesture was taken away from her: the row goes back where it was and nothing is saved.
    current.target = current.index
    current.dy = 0
    settling.value = true
    settleTimer = window.setTimeout(() => land(current), durationOf('--duration-quick'))
  }

  function land(current: Drag) {
    still.value = true
    const { index, target, title } = current
    drag.value = null
    settling.value = false
    if (target !== index) {
      options.onCommit(index, target)
      options.announce(options.msgs.moved(title, index, target))
    } else {
      options.announce(options.msgs.dropped)
    }
    requestAnimationFrame(() => requestAnimationFrame(() => (still.value = false)))
  }

  // --------------------------------------------------------------- the page

  /** Where the page scrolls itself, in px from either edge: the two touch sizes. */
  function edgeSize(): number {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--size-touch').trim()
    return 2 * (Number.parseFloat(value) || TOUCH_FALLBACK)
  }

  // Near the top or bottom of the screen the page scrolls on its own, so a Book
  // can travel further than one screen.
  function autoScroll() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(function step() {
      const current = drag.value
      if (!current) return
      const edge = edgeSize()
      const y = current.lastClientY
      const speed = y > window.innerHeight - edge ? 1 : y < edge ? -1 : 0
      if (speed) {
        window.scrollBy(0, speed * SCROLL_STEP)
        // Known drift, kept as it was: the rows were measured once, at the lift, so while the page
        // scrolls itself `follow` works from those stale rects (the row is placed by the scrolled
        // distance, but the places and the edges it is clamped to are where everything was then).
        follow(y)
      }
      frame = requestAnimationFrame(step)
    })
  }

  /** The pulse of the glide into place, or 0 with Reduce Motion (docs/MOTION.md, "State before motion"). */
  function durationOf(token: string): number {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000 || 0
  }

  // ------------------------------------------------------------- the touch list

  /** While a row is lifted, the finger moves the row, not the page (bound on the list, non-passive). */
  function rowTouchmove(event: TouchEvent) {
    if (drag.value) event.preventDefault()
  }

  /** A long press on a phone would open the link's menu; while holding a row, it does not. */
  function contextmenu(event: Event) {
    if (hold || drag.value) event.preventDefault()
  }

  /** The tap that ends a hold that lifted a row is not a tap on the Book. */
  function clickCapture(event: MouseEvent) {
    if (!swallowClick) return
    swallowClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  onMounted(() => {
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    cancelHold()
    cancelAnimationFrame(frame)
    window.clearTimeout(settleTimer)
  })

  return { drag, settling, still, gripDown, rowDown, move, up, cancel, contextmenu, clickCapture, rowTouchmove }
}
