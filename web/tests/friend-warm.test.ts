import { describe, expect, it } from 'vitest'
import { createTapWarmer, createWarmBudget, friendIdOfHref } from '../app/utils/friendWarm'

const ID = '7d85d035-e700-4a51-8a17-fc789b45f847'

describe('friendIdOfHref', () => {
  it('names the friend a link leads to', () => {
    expect(friendIdOfHref(`/friends/${ID}`)).toBe(ID)
    expect(friendIdOfHref(`/friends/${ID}/`)).toBe(ID)
    expect(friendIdOfHref(`/friends/${ID.toUpperCase()}?from=feed`)).toBe(ID)
  })
  it('knows no other address: the tab, her year pages, other screens, nothing', () => {
    for (const href of ['/friends', '/friends/people', `/friends/${ID}/2025`, `/book/${ID}`, `https://x.test/friends/${ID}`, '', null, undefined]) {
      expect(friendIdOfHref(href)).toBeNull()
    }
  })
})

describe('createWarmBudget (one for the session, not per screen)', () => {
  const t0 = 1_000_000
  it('lets a few friends be warmed by rows in any window, each once while her warm lasts', () => {
    const budget = createWarmBudget({ limit: 2, windowMs: 60_000, keepMs: 30_000 })
    expect(budget.take('a', t0)).toBe(true)
    expect(budget.take('a', t0 + 1)).toBe(false)
    expect(budget.take('b', t0 + 2)).toBe(true)
    expect(budget.take('c', t0 + 3)).toBe(false)
  })
  it('is the same across screens: a second visit to People does not warm three again, a new window does', () => {
    const budget = createWarmBudget({ limit: 3, windowMs: 5 * 60_000, keepMs: 3 * 60_000 })
    for (const id of ['a', 'b', 'c']) expect(budget.take(id, t0)).toBe(true)
    // The next screen, a minute later: the same friends, and other rows, are refused.
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(budget.take(id, t0 + 60_000)).toBe(false)
    // Once the window has passed, others may be warmed (and a friend whose answer has lapsed again).
    expect(budget.take('d', t0 + 5 * 60_000 + 1)).toBe(true)
    expect(budget.take('a', t0 + 5 * 60_000 + 2)).toBe(true)
  })
  it('remembers a friend a tap warmed (no second warm by her row), and the tap itself is never refused', () => {
    const budget = createWarmBudget({ limit: 1 })
    budget.note('a', t0)
    expect(budget.take('a', t0 + 1)).toBe(false)
    expect(budget.take('b', t0 + 2)).toBe(true)
    budget.note('c', t0 + 3)
    budget.note('d', t0 + 4)
  })
})

describe('createTapWarmer (a tap, not a finger that scrolls)', () => {
  function rig() {
    const warmed: string[] = []
    const timers = new Map<number, { run: () => void; ms: number }>()
    let next = 1
    const tap = createTapWarmer((id) => warmed.push(id), {
      setTimer: (run, ms) => {
        timers.set(next, { run, ms })
        return next++
      },
      clearTimer: (id) => void timers.delete(id as number),
    })
    const fire = () => [...timers.values()].forEach((t) => t.run())
    return { tap, warmed, timers, fire }
  }

  it('warms a finger that stays down for the wait', () => {
    const { tap, warmed, fire, timers } = rig()
    tap.down('a', 10, 10)
    expect([...timers.values()][0]!.ms).toBe(80)
    expect(warmed).toEqual([])
    fire()
    expect(warmed).toEqual(['a'])
    tap.up()
    tap.click('a')
    expect(warmed, 'once for the gesture').toEqual(['a'])
  })

  it('warms a quick tap when the finger lifts, once, and its click adds nothing', () => {
    const { tap, warmed } = rig()
    tap.down('a', 10, 10)
    tap.up()
    expect(warmed).toEqual(['a'])
    tap.click('a')
    expect(warmed).toEqual(['a'])
  })

  it('warms nothing for a scroll: moved away, taken by the browser (cancel), or the page moved', () => {
    const moved = rig()
    moved.tap.down('a', 10, 10)
    moved.tap.move(10, 40)
    moved.fire()
    moved.tap.up()
    expect(moved.warmed).toEqual([])

    const cut = rig()
    cut.tap.down('b', 10, 10)
    cut.tap.cancel()
    cut.fire()
    cut.tap.up()
    expect(cut.warmed).toEqual([])
  })

  it('lets a finger wobble within the slop', () => {
    const { tap, warmed } = rig()
    tap.down('a', 10, 10)
    tap.move(12, 13)
    tap.up()
    expect(warmed).toEqual(['a'])
  })

  it('warms a click no pointer led to (the keyboard), once', () => {
    const { tap, warmed } = rig()
    tap.click('a')
    expect(warmed).toEqual(['a'])
  })

  it('does not warm twice when a second finger goes down on another row before the first wait ends', () => {
    const { tap, warmed } = rig()
    tap.down('a', 0, 0)
    tap.down('b', 50, 50)
    tap.up()
    expect(warmed).toEqual(['b'])
  })
})
