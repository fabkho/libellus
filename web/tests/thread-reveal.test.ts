import { describe, expect, it } from 'vitest'
import { revealThread, THREAD_REVEAL } from '@/utils/threadReveal'

/**
 * The reveal of a thread a chapter opens with (docs/MOTION.md, "A chapter's notes";
 * `pages/notes/[book]/[chapter].vue`). The motion itself cannot be seen in a test, but its rules can: which
 * tokens, how far, and what Reduce Motion gets.
 */
/** A stand-in for the thread's own element: what the motion writes to it, and nothing else. */
function fakeThread() {
  const played: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = []
  return { played, animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => void played.push({ keyframes, options }) }
}

describe('the thread’s reveal', () => {
  it('rises the last `xs` into place over `standard`, and is the design’s own token', () => {
    const thread = fakeThread()
    revealThread(thread, { duration: 250, reduced: false })
    expect(thread.played).toHaveLength(1)
    expect(thread.played[0]!.keyframes).toEqual([
      { opacity: 0, transform: `translateY(${THREAD_REVEAL.rise}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ])
    expect(thread.played[0]!.options).toMatchObject({ duration: 250, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' })
  })

  it('never travels with Reduce Motion: the state still arrives, the messages do not move', () => {
    const thread = fakeThread()
    revealThread(thread, { duration: 150, reduced: true })
    // Opacity alone: no `transform` in either frame, so nothing slides and the scroll cannot move.
    expect(thread.played[0]!.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
    expect(thread.played[0]!.options).toMatchObject({ duration: 150, fill: 'both' })
  })

  it('moves nothing in the layout: `transform` and `opacity` only, as the laws require', () => {
    for (const reduced of [true, false]) {
      const thread = fakeThread()
      revealThread(thread, { duration: 250, reduced })
      for (const frame of thread.played[0]!.keyframes) expect(Object.keys(frame).sort()).toEqual(reduced ? ['opacity'] : ['opacity', 'transform'])
    }
  })

  it('does nothing on a page with no thread element (a veiled chapter, a missing Book)', () => {
    expect(() => revealThread(null, { duration: 250, reduced: false })).not.toThrow()
  })
})
