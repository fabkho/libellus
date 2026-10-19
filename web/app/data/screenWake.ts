/**
 * Keeps the screen on while something the member watches is running (the import's lookups), through the Screen
 * Wake Lock API. The browser drops the lock whenever the page is hidden, so it is asked for again when the page
 * comes back and the want is still on. Where the API is missing or refuses (battery saver, an older iOS), nothing
 * happens and the screen turns off as usual: the import carries on while the page is open. Framework-free: the
 * API and the document come in from outside; the reader's own lock (`components/reader/Reader.vue`) is its own.
 */

export type WakeLockApi = { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
export type VisibilitySource = {
  visibilityState: string
  addEventListener: (type: 'visibilitychange', listener: () => void) => void
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void
}

export type ScreenWake = {
  /** Whether the screen should be kept on now. */
  want: (wanted: boolean) => void
  /** Releases the lock and stops listening. */
  dispose: () => void
  /** Whether a lock is held right now. */
  held: () => boolean
}

export function createScreenWake(api: WakeLockApi | undefined | null, doc: VisibilitySource): ScreenWake {
  let wanted = false
  let sentinel: { release: () => Promise<void> } | null = null
  let asking = false

  async function acquire() {
    if (!api || !wanted || sentinel || asking || doc.visibilityState !== 'visible') return
    asking = true
    try {
      const got = await api.request('screen')
      // Not wanted any more while it was granted: let it go at once.
      if (wanted) sentinel = got
      else void got.release().catch(() => {})
    } catch {
      // Refused: the screen turns off as usual.
    } finally {
      asking = false
    }
  }
  function release() {
    void sentinel?.release().catch(() => {})
    sentinel = null
  }
  function onVisibility() {
    // The browser let the lock go when the page was hidden; it is asked for again once the page is back.
    if (doc.visibilityState === 'visible') {
      sentinel = null
      void acquire()
    }
  }
  doc.addEventListener('visibilitychange', onVisibility)

  return {
    want(next) {
      wanted = next
      if (next) void acquire()
      else release()
    },
    dispose() {
      wanted = false
      release()
      doc.removeEventListener('visibilitychange', onVisibility)
    },
    held: () => sentinel !== null,
  }
}
