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

/** Whether the field waits for the rise on this device. */
export function defersFieldFocus(env: InstallEnvironment, policy: { ios: boolean; elsewhere: boolean } = FIELD_FOCUS_AFTER_RISE): boolean {
  return isIos(env) ? policy.ios : policy.elsewhere
}

/** The slice of `navigator` the policy reads. */
export function browserEnvironment(): InstallEnvironment {
  return { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }
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

/**
 * Runs `run` once: when `settled()` is called (the sheet's `data-moving` has
 * cleared) or, failing that, after `fallback` ms. `cancel()` drops it (the sheet
 * closed first). Whichever comes first wins; the other does nothing.
 */
export function afterRise(run: () => void, fallback: number, timers: Timers = realTimers) {
  let done = false
  const handle = timers.set(() => settled(), fallback)
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
  return { settled, cancel }
}
