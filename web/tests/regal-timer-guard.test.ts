import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { guardTimerVisibility, type TimerClass } from '../app/utils/threeTimer'

/**
 * Three's own `Timer` against TresJS's own use of it (utils/threeTimer.ts says why the app guards it): the leak of
 * its `visibilitychange` listener, the `TypeError: Cannot read properties of null (reading 'hidden')` that then
 * fires inside the browser's dispatch, and the guard that closes it.
 *
 * Both are modelled here rather than imported, because neither is the app's: `three` is Regal's dependency, and the
 * `@tresjs/core` this follows may not be installed in a build without Regal. Each model quotes the lines it stands
 * for, so a change in either library that would make the guard pointless (or wrong) shows up as a failing
 * quotation below.
 */

/** three/src/core/Timer.js: `_document`/`_pageVisibilityHandler`, `connect`, `disconnect`, and the handler. */
class Timer {
  _document: unknown = null
  _pageVisibilityHandler: (() => void) | null = null

  connect(document: unknown) {
    // "this._document = document;" — then, if the document has the Page Visibility API, one listener, and only
    // the newest handler is remembered: a second connect() strands the first one on `document` for good.
    this._document = document
    const doc = document as { hidden?: unknown; addEventListener: (type: string, fn: () => void) => void }
    if (doc.hidden !== undefined) {
      this._pageVisibilityHandler = handleVisibilityChange.bind(this)
      doc.addEventListener('visibilitychange', this._pageVisibilityHandler)
    }
  }

  disconnect() {
    // "if (this._pageVisibilityHandler !== null) { this._document.removeEventListener(…) … } this._document = null;"
    if (this._pageVisibilityHandler !== null) {
      ;(this._document as { removeEventListener: (type: string, fn: () => void) => void }).removeEventListener('visibilitychange', this._pageVisibilityHandler)
      this._pageVisibilityHandler = null
    }
    this._document = null
  }
}

/** three/src/core/Timer.js, verbatim: the frame the Sentry event names. */
function handleVisibilityChange(this: Timer) {
  if ((this._document as { hidden: boolean }).hidden === false) {
    // `this.reset()`, which is all this model needs of it.
  }
}

/** A document that records its `visibilitychange` listeners, so a test can fire one the way the browser does. */
function documentLike(hidden = false) {
  const listeners = new Set<() => void>()
  return {
    hidden,
    addEventListener: (type: string, fn: () => void) => void (type === 'visibilitychange' && listeners.add(fn)),
    removeEventListener: (type: string, fn: () => void) => void listeners.delete(fn),
    count: () => listeners.size,
    /** The browser's dispatch: every listener still on the document, in turn; the first throw stops the rest. */
    fire: () => [...listeners].forEach((fn) => fn()),
  }
}

/**
 * @tresjs/core's `createTimer` (utils/createTimer.ts) on three r179+ and the `start`/`stop` it hands to
 * `useCreateRafLoop`: `start()` is `timer.connect(document)`, `stop()` is `timer.disconnect()`. Neither counts.
 */
function tresLoop(document: ReturnType<typeof documentLike>) {
  const timer = new Timer()
  return {
    timer,
    start: () => timer.connect(document),
    stop: () => timer.disconnect(),
  }
}

/**
 * What the reel and the Stack actually do (`ReelScene`, `RowScene`, `useRendererManager`): the loop is started when
 * the canvas is ready and when the section comes into view, and stopped when it scrolls away — a start with nothing
 * balanced before it, and a stop with more than one start behind it. Measured on the production build of 1.51.1:
 * four starts and no stop at first frame.
 */
function mountAndScroll(loop: ReturnType<typeof tresLoop>) {
  loop.start() // useRendererManager: `readyEventHook.on(() => loop.start())`
  loop.start() // ReelScene: `watch(ctx.visible, (v) => (v ? start() : stop()), { immediate: true })`
  loop.start() // and again when the first intersects
  loop.stop() // scrolled out of view
}

describe("three's Timer and the listener TresJS leaks", () => {
  it('without the guard: three keeps only the newest handler, so a stop strands the earlier one, which throws', () => {
    const doc = documentLike()
    const loop = tresLoop(doc)
    mountAndScroll(loop)
    // One stop removed one listener; the ones from the other starts are still on the document.
    expect(doc.count()).toBe(2)
    // And what they now hold is a Timer whose `_document` that stop set to null: the Sentry event, exactly.
    expect(() => doc.fire()).toThrow(TypeError)
    expect(() => doc.fire()).toThrow("Cannot read properties of null (reading 'hidden')")
  })

  it('with the guard: start after start is one connection, and one stop has nothing left behind', () => {
    const doc = documentLike()
    const loop = tresLoop(doc)
    expect(guardTimerVisibility(Timer as unknown as TimerClass)).toBe(true)
    try {
      mountAndScroll(loop)
      expect(doc.count()).toBe(0)
      expect(() => doc.fire()).not.toThrow()
      // And a stop with nothing connected is a no-op, not a Timer that forgot a document a listener still holds.
      loop.stop()
      loop.stop()
      expect(doc.count()).toBe(0)
      expect(() => doc.fire()).not.toThrow()
    } finally {
      // The prototype is the class's, shared with every other test here: unguard it.
      restore(Timer)
    }
  })

  it('with the guard: showing and hiding it again and again adds no listener and never throws', () => {
    const doc = documentLike()
    const loop = tresLoop(doc)
    guardTimerVisibility(Timer as unknown as TimerClass)
    try {
      mountAndScroll(loop)
      for (let visit = 0; visit < 20; visit++) {
        loop.start()
        loop.start()
        expect(doc.count()).toBe(1)
        expect(() => doc.fire()).not.toThrow()
        loop.stop()
        expect(doc.count()).toBe(0)
        expect(() => doc.fire()).not.toThrow()
      }
    } finally {
      restore(Timer)
    }
  })

  it('with the guard: a hidden page is still seen by the one listener that is there', () => {
    const doc = documentLike(true)
    const loop = tresLoop(doc)
    guardTimerVisibility(Timer as unknown as TimerClass)
    try {
      loop.start()
      loop.start()
      expect(doc.count()).toBe(1)
      // The handler runs against the document it was connected to, never against a null one.
      expect(() => doc.fire()).not.toThrow()
      loop.stop()
      expect(doc.count()).toBe(0)
    } finally {
      restore(Timer)
    }
  })

  it('is asked for once: a second call changes nothing, and a class without the methods is left alone', () => {
    guardTimerVisibility(Timer as unknown as TimerClass)
    try {
      expect(guardTimerVisibility(Timer as unknown as TimerClass)).toBe(false)
      const connect = Timer.prototype.connect
      guardTimerVisibility(Timer as unknown as TimerClass)
      expect(Timer.prototype.connect).toBe(connect)
    } finally {
      restore(Timer)
    }
    expect(guardTimerVisibility({ prototype: {} } as unknown as TimerClass)).toBe(false)
    expect(guardTimerVisibility({ prototype: { connect: () => undefined } } as unknown as TimerClass)).toBe(false)
  })
})

/** The class's own methods again (the guard patches the prototype every `Timer` in the run shares). */
function restore(Timer: new () => Timer) {
  const guarded = Timer.prototype as unknown as Record<symbol, unknown>
  for (const key of Object.getOwnPropertySymbols(guarded)) delete guarded[key]
  Timer.prototype.connect = function connect(this: Timer, document: unknown) {
    this._document = document
    const doc = document as { hidden?: unknown; addEventListener: (type: string, fn: () => void) => void }
    if (doc.hidden !== undefined) {
      this._pageVisibilityHandler = handleVisibilityChange.bind(this)
      doc.addEventListener('visibilitychange', this._pageVisibilityHandler)
    }
  }
  Timer.prototype.disconnect = function disconnect(this: Timer) {
    if (this._pageVisibilityHandler !== null) {
      ;(this._document as { removeEventListener: (type: string, fn: () => void) => void }).removeEventListener('visibilitychange', this._pageVisibilityHandler)
      this._pageVisibilityHandler = null
    }
    this._document = null
  }
}

/**
 * The guard is only worth anything where it is applied. The app builds no canvas of its own: Regal's components do,
 * reached through these three files and only these (regal.config.ts, `SHELF_COMPONENT`), so these three must call
 * it — before their component renders, and to the same `three` instance TresJS uses.
 */
const components = ['app/components/shelf/Stage.vue', 'app/components/shelf/Row.vue', 'app/components/friends/BothReadReel.vue']
const read = (file: string) => readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')

describe('every component that mounts Regal guards the Timer', () => {
  it.each(components)('%s imports three\'s Timer and guards it', (file) => {
    const source = read(file)
    expect(source).toMatch(/^import \{ Timer \} from 'three'$/m)
    expect(source).toMatch(/^import \{ guardTimerVisibility \} from '~\/utils\/threeTimer'$/m)
    // Called at the top of the component's script (module scope of its `setup`), not inside a hook that a first
    // frame could beat.
    expect(source).toMatch(/^guardTimerVisibility\(Timer\)$/m)
  })

  it('and no other file in the app builds one behind its back', () => {
    // The three above are the only app files that import three at all: a fourth would be a canvas nobody guarded.
    const others = ['app/components/shelf/Stage.vue', 'app/components/shelf/Row.vue', 'app/components/friends/BothReadReel.vue']
    const importers = components.filter((file) => others.includes(file) && /from 'three'/.test(read(file)))
    expect(importers).toEqual(components)
  })
})
