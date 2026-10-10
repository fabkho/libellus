import { isIos, type InstallEnvironment } from '~/utils/installHint'

/**
 * When a sheet's field (`data-autofocus`) takes focus, and so when the keyboard
 * comes up (docs/MOTION.md, Sheet).
 *
 * Focus goes in two stages. The panel has it at once (the focus trap and
 * VoiceOver need focus inside the sheet from the first frame); the field has
 * it only once the sheet has finished rising, so the keyboard does not arrive
 * while the panel is still on `--duration-sheet`, with the panel moving on the
 * keyboard's curve (UiSheet's `lift`) over the top of it.
 *
 * ONE PLACE to flip: `FIELD_FOCUS_AFTER_RISE`. Deferred everywhere by default.
 * The open question is iOS, which may refuse to raise the keyboard for a
 * `focus()` that is not in the user's gesture: if an iPhone does not show the
 * keyboard, set `ios` to false and iOS goes back to focusing the field in the
 * tap that opens the sheet. Android and every other browser are unaffected.
 */
export const FIELD_FOCUS_AFTER_RISE = {
  ios: true,
  elsewhere: true,
}

/**
 * How long past `--duration-sheet` the field waits for the sheet's end-of-rise
 * signal before it takes focus anyway (ms): an animation event can arrive late
 * or not at all on a loaded browser (docs/MOTION.md, "Waiting for motion").
 */
export const RISE_FOCUS_MARGIN = 200

/**
 * How long the fallback waits before it looks again, when the panel turns out
 * to be on its way still (ms). The fallback's deadline is measured from the
 * opening tap, but the rise itself starts a frame or two later — Vue takes the
 * `enter-from` class off and arms the end of the enter on the next frames, and
 * a loaded browser can stretch those past the margin (CI: the field took focus
 * mid-rise, run 38000897658). So the fallback asks the panel, not its own clock, and looks again.
 */
export const RISE_FOCUS_RETRY = 100

/** How many looks the fallback takes before it settles anyway (2 s of patience): a rise that never reports its end cannot hold the keyboard back for good. */
export const RISE_FOCUS_RETRIES = 20

/** Whether the field waits for the rise on this device. */
export function defersFieldFocus(env: InstallEnvironment, policy: { ios: boolean; elsewhere: boolean } = FIELD_FOCUS_AFTER_RISE): boolean {
  return isIos(env) ? policy.ios : policy.elsewhere
}

/** The slice of `navigator` the policy reads. */
export function browserEnvironment(): InstallEnvironment {
  return { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }
}

/**
 * Whether the panel is still on its way: the rise has not begun (Vue's
 * `sheet-enter-from` is still on it) or its own transition is running. The
 * fallback asks this instead of trusting its deadline, so a late frame cannot
 * put the keyboard on the field in the middle of the rise.
 */
export function panelIsRising(panel: HTMLElement | null | undefined): boolean {
  if (!panel) return false
  if (panel.classList.contains('sheet-enter-from')) return true
  return panel.getAnimations({ subtree: false }).some((animation) => animation.playState === 'running')
}

/**
 * Whether the field may take focus now: nothing else inside the sheet has it.
 * Focus on the panel itself (stage 1), on `<body>` or outside the sheet counts
 * as nothing; on any control inside the panel it is the member's (they tapped
 * somewhere during the rise) and is left alone.
 */
export function fieldMayTakeFocus(active: Element | null, panel: Element): boolean {
  return !active || active === panel || !panel.contains(active)
}

type Timers = {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}
const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) }

/** What `afterRise` may be told: the clock it runs on, and whether the panel is still on its way. */
type RiseWait = {
  timers?: Timers
  stillRising?: () => boolean
}

/**
 * Runs `run` once: when `settled()` is called (the sheet's `data-moving` has
 * cleared) or, failing that, after `fallback` ms. `cancel()` drops it (the sheet
 * closed first). Whichever comes first wins; the other does nothing.
 *
 * The fallback is a last resort, not a second opinion: before it runs, it asks
 * `stillRising()`, and a panel that says it is on its way gets another
 * `RISE_FOCUS_RETRY` ms and another look (up to `RISE_FOCUS_RETRIES` of them, so
 * a rise that never ends still gives up). A signal that is late is not a rise
 * that is over, and taking focus mid-rise is what puts the keyboard up over a
 * panel still on the move.
 */
export function afterRise(run: () => void, fallback: number, { timers = realTimers, stillRising = () => false }: RiseWait = {}) {
  let done = false
  let looks = 0
  let handle: unknown
  function arm(ms: number) {
    handle = timers.set(comeDue, ms)
  }
  function comeDue() {
    if (done) return
    if (stillRising() && looks++ < RISE_FOCUS_RETRIES) return arm(RISE_FOCUS_RETRY)
    settled()
  }
  function settled() {
    if (done) return
    done = true
    timers.clear(handle)
    run()
  }
  function cancel() {
    if (done) return
    done = true
    timers.clear(handle)
  }
  arm(fallback)
  return { settled, cancel }
}
