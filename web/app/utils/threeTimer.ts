/**
 * Three's `Timer` (three/src/core/Timer.js) is what TresJS drives a canvas's render loop with
 * (`@tresjs/core` `utils/createTimer.ts`, `composables/useCreateRafLoop`): `connect(document)` registers its own
 * `visibilitychange` listener, `disconnect()` removes it and forgets the document.
 *
 * **The defect it cannot survive:** `connect()` is not idempotent, `disconnect()` is not a no-op when there is
 * nothing to remove, and TresJS's `start()`/`stop()` are not balanced. `start()` calls `timer.connect(document)`
 * on every call while it only ever disconnects once, and three's `connect()` keeps the *last* handler it made in
 * `_pageVisibilityHandler` — so the earlier ones stay on `document` for good, bound to a `Timer` whose
 * `_document` `disconnect()` has since set to `null`:
 *
 *   TypeError: Cannot read properties of null (reading 'hidden')      (`this._document.hidden === false`)
 *
 * It is thrown from inside the browser's own dispatch of `visibilitychange`, so it is unhandled and Sentry files
 * it as `auto.browser.browserapierrors.addEventListener` (LIBELLUS-1, LIBELLUS-5: 22 releases, every one a
 * friend's profile or her shelf). Measured on the production build of 1.51.1: a reel that mounts and shows a
 * first frame has already connected four times and disconnected never, and one hide-and-show cycle adds a fifth
 * listener and one disconnect — three stale listeners at mount, one more per visit to the background, each of
 * them throwing the next time the page's visibility changes. Nothing of ours can reach the `Timer` instance
 * (TresJS keeps it in `useCreateRafLoop`'s closure, and only `loop.start()`/`loop.stop()` are handed out), so it
 * cannot be guarded where the tick runs: this closes the hole at the source of the leak instead.
 *
 * `guardTimerVisibility` makes those two methods behave as their own documentation says they do — `connect()` is
 * "connect to the given document" (already connected: nothing to do), `disconnect()` is "disconnect from the DOM"
 * (not connected: nothing to disconnect). TresJS then leaks no listener however often it starts its loop, and a
 * disconnected `Timer` can never dereference a document it let go of.
 *
 * **Delete this file, and the three imports of it, once `@tresjs/core` fixes `useCreateRafLoop`** (it must call
 * `timer.connect()` once per connection rather than once per `start()`; three's own `Timer` cannot be fixed from
 * here). Regal's components are the only canvases the app builds — the reel of "You both read" and the shelf's
 * Stack and row — and they all call it, so a later `stop()`/`start()` in any of them is covered too.
 *
 * Pure and dependency-free (the `Timer` class comes in as an argument), so `tests/regal-timer-guard.test.ts`
 * drives it in plain Node against three's own contract.
 */

/** The parts of three's `Timer` this guards; a class, not an instance (the prototype is what is patched). */
export interface TimerClass {
  prototype: {
    connect?: (document: unknown) => void
    disconnect?: () => void
    /** Set while the document the timer was connected to. Ours: three keeps no such flag. */
    [CONNECTED]?: unknown
    /** Whether this prototype has already been guarded, so a second chunk patching it changes nothing. */
    [GUARDED]?: true
  }
}

const CONNECTED = Symbol.for('libellus.threeTimer.connected')
const GUARDED = Symbol.for('libellus.threeTimer.guarded')

/**
 * Makes `connect`/`disconnect` idempotent on the class's prototype (see above). Returns whether it patched
 * anything: a class without them (another three major, a renamed API) is left alone, and asking twice is free.
 */
export function guardTimerVisibility(Timer: TimerClass): boolean {
  const prototype = Timer.prototype
  if (prototype[GUARDED]) return false
  const connect = prototype.connect
  const disconnect = prototype.disconnect
  if (typeof connect !== 'function' || typeof disconnect !== 'function') return false

  prototype.connect = function connectOnce(this: { [CONNECTED]?: unknown }, document: unknown) {
    // The same document, again: three would add a second listener and keep only the newer handler in
    // `_pageVisibilityHandler`, so the first could never be removed. This is the leak.
    if (this[CONNECTED] === document) return
    // Another document: let go of the one held (balanced, so nothing is stranded) before taking the new one.
    if (this[CONNECTED] !== undefined) disconnect.call(this)
    connect.call(this, document)
    this[CONNECTED] = document
  }

  prototype.disconnect = function disconnectOnce(this: { [CONNECTED]?: unknown }) {
    // Nothing to remove: three would still set `_document = null`, which is what a listener left over from an
    // earlier `connect()` then dereferences.
    if (this[CONNECTED] === undefined) return
    this[CONNECTED] = undefined
    disconnect.call(this)
  }

  prototype[GUARDED] = true
  return true
}
