import { describe, expect, it } from 'vitest'
import { clampDy, offsetsFor, targetFor, type DragRow } from '../app/composables/useDragReorder'

/**
 * The three pure functions of the Collection's drag (`composables/useDragReorder.ts`): where a lifted
 * row will land, how far it may travel, and where every row sits while it passes. Plain data in Node —
 * no DOM, no component, no store. The gesture's own wiring (the hold, the window's pointers, the
 * auto-scroll) is checked by hand in the browser; these are the numbers behind it.
 */

/** Four rows of the same height, one under the other, in page coordinates: tops 0, 72, 144, 216. */
const ROWS: DragRow[] = [
  { top: 0, height: 72 },
  { top: 72, height: 72 },
  { top: 144, height: 72 },
  { top: 216, height: 72 },
]

/** Rows of different heights, so a place's distance is not just a multiple of one height. */
const UNEVEN: DragRow[] = [
  { top: 0, height: 50 },
  { top: 50, height: 100 },
  { top: 150, height: 60 },
]

describe('where a lifted row lands', () => {
  it('goes one place down once its centre has passed the next row’s', () => {
    // Lifted from the first row (centre 36, its own place while the finger is still), taken 80 px down.
    const dy = clampDy(ROWS, 0, 80)
    expect(dy).toBe(80)
    // Its centre is now 36 + 80 = 116, past the second row's centre (108) and short of the third's (180).
    expect(targetFor(ROWS, 0, 36 + dy)).toBe(1)
    // A row past its own place is not counted against itself, and the rows it has not reached are not either.
    expect(targetFor(ROWS, 0, 36 + 160)).toBe(2)
    expect(targetFor(ROWS, 0, 36)).toBe(0)
  })

  it('goes one place up once its centre has passed the row above’s, downwards from the end', () => {
    // Lifted from the last row (own centre 252), taken 80 px up.
    const dy = clampDy(ROWS, 3, -80)
    expect(dy).toBe(-80)
    // Its centre is now 252 - 80 = 172: past the second row's (108), short of the third's (180).
    expect(targetFor(ROWS, 3, 252 + dy)).toBe(2)
    expect(targetFor(ROWS, 3, 252 - 200)).toBe(1)
    expect(targetFor(ROWS, 3, 252)).toBe(3)
  })

  it('lands where the row it passed sat, whatever the rows’ heights', () => {
    // The first row (centre 25) down past the tall one (centre 100) but not past the third (centre 180).
    expect(targetFor(UNEVEN, 0, 25 + 90)).toBe(1)
    expect(targetFor(UNEVEN, 0, 25 + 170)).toBe(2)
  })

  it('has an answer for a list that is gone', () => {
    expect(targetFor([], 0, 500)).toBe(0)
  })
})

describe('how far a lifted row may travel', () => {
  it('stops at the top of the list', () => {
    // From the second place the row may rise as far as the first row's top (-72), and no further.
    expect(clampDy(ROWS, 1, -10)).toBe(-10)
    expect(clampDy(ROWS, 1, -72)).toBe(-72)
    expect(clampDy(ROWS, 1, -500)).toBe(-72)
    // From the first place there is nowhere up to go.
    expect(clampDy(ROWS, 0, -500)).toBe(0)
    expect(clampDy(ROWS, 0, 0)).toBe(0)
  })

  it('stops at the bottom of the list, its own height kept inside', () => {
    // The first row may go down until its bottom meets the last row's (216 + 72 - 72).
    expect(clampDy(ROWS, 0, 100)).toBe(100)
    expect(clampDy(ROWS, 0, 216)).toBe(216)
    expect(clampDy(ROWS, 0, 4000)).toBe(216)
    // The last row is already there.
    expect(clampDy(ROWS, 3, 4000)).toBe(0)
    expect(clampDy(ROWS, 3, -216)).toBe(-216)
    expect(clampDy(ROWS, 3, -4000)).toBe(-216)
  })

  it('keeps a tall row inside a list of short ones', () => {
    // The tall row (100) travels less than a short one: the list's bottom is 210.
    expect(clampDy(UNEVEN, 1, 4000)).toBe(150 + 60 - 100 - 50)
    expect(clampDy(UNEVEN, 1, -4000)).toBe(-50)
  })

  it('has an answer for a row that is not there', () => {
    expect(clampDy([], 0, 50)).toBe(0)
    expect(clampDy(ROWS, 9, 50)).toBe(0)
  })
})

describe('where every row sits while one is moving', () => {
  it('moves the lifted row by the finger, and the rows it passed up by its height', () => {
    // The first row dragged two places down, its centre between the third's place and landing.
    expect(offsetsFor(ROWS, 0, 2, 40)).toEqual([40, -72, -72, 0])
    // Its own place while it has not passed anything yet.
    expect(offsetsFor(ROWS, 0, 0, 20)).toEqual([20, 0, 0, 0])
    // Down one place only.
    expect(offsetsFor(ROWS, 0, 1, 60)).toEqual([60, -72, 0, 0])
  })

  it('moves the rows it passed down by its height going up', () => {
    expect(offsetsFor(ROWS, 2, 0, -100)).toEqual([72, 72, -100, 0])
    expect(offsetsFor(ROWS, 3, 1, -140)).toEqual([0, 72, 72, -140])
  })

  it('adds up the rows it passed, whatever their heights', () => {
    // The short first row to the last place: past the 100 and the 60, landing 160 below its own place.
    expect(offsetsFor(UNEVEN, 0, 2, 160)).toEqual([160, -50, -50])
    // The tall middle row to the top: past nothing, landing 50 above.
    expect(offsetsFor(UNEVEN, 1, 0, -50)).toEqual([100, -50, 0])
  })

  it('leaves the rows beyond the place it will take alone', () => {
    expect(offsetsFor(ROWS, 1, 2, 30)).toEqual([0, 30, -72, 0])
    expect(offsetsFor(ROWS, 2, 1, -30)).toEqual([0, 72, -30, 0])
  })

  it('is all zeros for an empty list and for a row that is not there', () => {
    expect(offsetsFor([], 0, 1, 50)).toEqual([])
    // Nothing makes room for a row that is not there, and nothing moves.
    expect(offsetsFor(ROWS, 9, 1, 50)).toEqual([0, 0, 0, 0])
  })
})
describe('a drag taken away from her', () => {
  /**
   * `cancel` puts the row back where it was: the target is its own index again and its offset 0 (the
   * composable's own rule). Through these functions that means every row in its own place, wherever the
   * finger had taken it — and the move is never made real.
   */
  const cancel = (rows: DragRow[], index: number) => offsetsFor(rows, index, index, 0)

  it('restores the target to the row’s own index', () => {
    // Mid-drag, the first row had already passed the second.
    expect(targetFor(ROWS, 0, 36 + 80)).toBe(1)
    expect(offsetsFor(ROWS, 0, 1, 80)).toEqual([80, -72, 0, 0])
    // Taken away from her, it is where it started and nothing makes room.
    expect(cancel(ROWS, 0)).toEqual([0, 0, 0, 0])
    expect(cancel(ROWS, 3)).toEqual([0, 0, 0, 0])
    expect(cancel(UNEVEN, 1)).toEqual([0, 0, 0])
  })
})
