import { describe, expect, it } from 'vitest'
import { barAfterScroll, barHeld, barShown, INTENT_PX, MIN_END_PX, type BarScroll } from '@/utils/hideOnScroll'

/**
 * The tab bar on a pushed screen (issue #82, utils/hideOnScroll.ts): it hides
 * on a scroll down, shows on a short scroll up, ignores scrolls shorter than
 * the intent, is always there at the top and the end of the page, and stays on
 * a page that is only a little longer than the screen (`MIN_END_PX`).
 */

const END = 2000

/** Scrolls through `ys` one event at a time, starting shown at the first, on a page of `end`. */
function through(ys: number[], start: BarScroll = barShown(ys[0]!), jump = Infinity, end = END): BarScroll {
  return ys.slice(1).reduce((state, y) => barAfterScroll(state, y, end, INTENT_PX, jump), start)
}

describe('barAfterScroll', () => {
  it('hides once a scroll down has gone past the intent', () => {
    expect(through([100, 105, 110]).hidden).toBe(false)
    expect(through([100, 105, 110, 111]).hidden).toBe(true)
    expect(through([100, 300]).hidden).toBe(true)
  })

  it('shows again once a scroll up has gone past the intent from where it turned', () => {
    const down = through([100, 400])
    expect(down.hidden).toBe(true)
    // Turned at 400: 8 px up is not enough, 12 is.
    expect(through([400, 392], down).hidden).toBe(true)
    expect(through([400, 392, 388], down).hidden).toBe(false)
  })

  it('does not toggle on small back-and-forth movements', () => {
    const down = through([100, 400])
    expect(through([400, 395, 402, 396, 403, 397], down).hidden).toBe(true)
    const up = through([400, 300], down)
    expect(up.hidden).toBe(false)
    expect(through([300, 306, 299, 307, 301], up).hidden).toBe(false)
  })

  it('counts a direction from its turning point, not from where it last toggled', () => {
    const down = through([100, 400])
    // Up 9 (not enough), then down again: the new descent counts from 391.
    const back = through([400, 391, 395, 402], down)
    expect(back.hidden).toBe(true)
    expect(back.anchor).toBe(391)
  })

  it('shows at the top, and above it (rubber band)', () => {
    const down = through([100, 400])
    expect(barAfterScroll(down, INTENT_PX, END).hidden).toBe(false)
    expect(barAfterScroll(down, 0, END).hidden).toBe(false)
    expect(barAfterScroll(down, -40, END).hidden).toBe(false)
  })

  it('shows at the end of the page, and past it', () => {
    const down = through([100, 1900])
    expect(down.hidden).toBe(true)
    expect(barAfterScroll(down, END - INTENT_PX, END).hidden).toBe(false)
    expect(barAfterScroll(down, END, END).hidden).toBe(false)
    expect(barAfterScroll(down, END + 30, END).hidden).toBe(false)
    // Scrolling back up from the end keeps it, as any scroll up does.
    expect(through([END, 1900], barAfterScroll(down, END, END)).hidden).toBe(false)
  })

  it('never hides on a page too short to scroll past both edges', () => {
    const short = (y: number) => barAfterScroll(barShown(0), y, 15)
    for (const y of [0, 5, 10, 15]) expect(short(y).hidden).toBe(false)
  })

  it('never hides on a page only a little longer than the screen', () => {
    // 500 px past the screen: it scrolls, but the bar is not worth moving for it.
    const short = MIN_END_PX - 140
    for (const y of [0, 100, 250, short - INTENT_PX - 1, short - INTENT_PX, short]) {
      expect(barAfterScroll(barShown(0), y, short).hidden).toBe(false)
    }
    // Back and forth over it: still nothing to read that it should make way for.
    expect(through([0, 120, 300, 180, 320], barShown(0), Infinity, short).hidden).toBe(false)
  })

  it('hides from `MIN_END_PX` of scroll on, as on any other page', () => {
    expect(through([100, 200], barShown(100), Infinity, MIN_END_PX).hidden).toBe(true)
    // One pixel less of page and it stays.
    expect(through([100, 200], barShown(100), Infinity, MIN_END_PX - 1).hidden).toBe(false)
  })

  it('starts hiding once later content grows the page past the threshold', () => {
    const short = through([0, 120, 300], barShown(0), Infinity, 400)
    expect(short.hidden).toBe(false)
    // A list loads, the page is long: the next scroll down hides the bar.
    expect(barAfterScroll(short, 320, MIN_END_PX + 900).hidden).toBe(true)
    // And a page that shrinks back under the threshold brings it back.
    expect(through([100, 400]).hidden).toBe(true)
    expect(barAfterScroll(through([100, 400]), 420, MIN_END_PX - 1).hidden).toBe(false)
  })

  it('reads a jump longer than `jump` as no intent: only the anchor moves', () => {
    const jumped = through([100, 1500], barShown(100), 800)
    expect(jumped.hidden).toBe(false)
    expect(jumped).toEqual({ hidden: false, anchor: 1500, last: 1500 })
    // And the next scroll counts from there.
    expect(through([1500, 1520], jumped, 800).hidden).toBe(true)
  })
})

describe('barHeld', () => {
  it('keeps the state and starts counting afresh from where the page is', () => {
    const down = through([100, 400])
    expect(barHeld(down, 900)).toEqual({ hidden: true, anchor: 900, last: 900 })
    expect(barAfterScroll(barHeld(down, 900), 880, END).hidden).toBe(false)
  })
})
