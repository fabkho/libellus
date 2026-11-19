import { describe, expect, it, vi } from 'vitest'
import { HIGHLIGHTS_POLL_MS, pollHighlights, SERVER_WAIT_MS, withinServerWait, type SessionTimers } from '../app/data/reader/session'

/**
 * The reader's two server waits and its highlight poll (#131 phase 2): the book
 * never waits longer than 800 ms for the place or the highlights, and while it
 * stays open the highlights are read every minute — but only with the page
 * showing and a connection, and again as soon as either returns. Fake timers,
 * no browser.
 */

/** A target that records its listeners, so a test can fire one. */
function target() {
  const listeners = new Map<string, Set<() => void>>()
  return {
    addEventListener: (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
    fire: (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn()),
    count: (type: string) => listeners.get(type)?.size ?? 0,
  }
}

/** The browser's timers on Vitest's fake clock, with the page visible as a test says. */
function timers(visible = true): SessionTimers {
  return {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    interval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    visible: () => visible,
  }
}

describe('waiting for the server', () => {
  it('takes the answer when it comes in time', async () => {
    const answer = withinServerWait(Promise.resolve('the server'), 'the device')
    await expect(answer).resolves.toBe('the server')
  })

  it('falls back to the device after 800 ms, and lets the slow answer settle anyway', async () => {
    vi.useFakeTimers()
    try {
      let settled = ''
      const slow = new Promise<string>((resolve) => setTimeout(() => resolve('the server'), 5_000))
      void withinServerWait(slow, 'the device', timers()).then((value) => (settled = value))
      await vi.advanceTimersByTimeAsync(SERVER_WAIT_MS - 1)
      expect(settled).toBe('')
      await vi.advanceTimersByTimeAsync(1)
      expect(settled).toBe('the device')
      // The answer still arrives; nothing waits for it, and nothing rejects.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(settled).toBe('the device')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the highlight poll', () => {
  it('reads every minute while the page is showing and the app is online', () => {
    vi.useFakeTimers()
    try {
      const read = vi.fn()
      const stop = pollHighlights(read, () => true, { document: { ...target(), visibilityState: 'visible' }, window: target() }, timers())
      expect(read).not.toHaveBeenCalled()
      vi.advanceTimersByTime(HIGHLIGHTS_POLL_MS - 1)
      expect(read).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(read).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(HIGHLIGHTS_POLL_MS * 2)
      expect(read).toHaveBeenCalledTimes(3)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips a tick with the page hidden or without a connection', () => {
    vi.useFakeTimers()
    try {
      let visible = true
      let online = true
      const read = vi.fn()
      const stop = pollHighlights(read, () => online, { document: { ...target(), visibilityState: 'visible' }, window: target() }, { ...timers(), visible: () => visible })
      visible = false
      vi.advanceTimersByTime(HIGHLIGHTS_POLL_MS)
      expect(read).not.toHaveBeenCalled()
      visible = true
      online = false
      vi.advanceTimersByTime(HIGHLIGHTS_POLL_MS)
      expect(read).not.toHaveBeenCalled()
      online = true
      vi.advanceTimersByTime(HIGHLIGHTS_POLL_MS)
      expect(read).toHaveBeenCalledTimes(1)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads at once when the app comes back to the foreground, or the connection returns', () => {
    vi.useFakeTimers()
    try {
      const read = vi.fn()
      const doc = { ...target(), visibilityState: 'visible' }
      const win = target()
      const stop = pollHighlights(read, () => true, { document: doc, window: win }, timers())
      doc.fire('visibilitychange')
      expect(read).toHaveBeenCalledTimes(1)
      win.fire('online')
      expect(read).toHaveBeenCalledTimes(2)
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops as it was told to: no more ticks, and neither listener left behind', () => {
    vi.useFakeTimers()
    try {
      const read = vi.fn()
      const doc = { ...target(), visibilityState: 'visible' }
      const win = target()
      const stop = pollHighlights(read, () => true, { document: doc, window: win }, timers())
      expect([doc.count('visibilitychange'), win.count('online')]).toEqual([1, 1])
      stop()
      expect([doc.count('visibilitychange'), win.count('online')]).toEqual([0, 0])
      vi.advanceTimersByTime(HIGHLIGHTS_POLL_MS * 3)
      doc.fire('visibilitychange')
      win.fire('online')
      expect(read).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
