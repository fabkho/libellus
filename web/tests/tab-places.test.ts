import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTabPlaces, PLACE_PATIENCE, untilReachable, type PageWatch, type Reach } from '@/utils/tabPlaces'

/** Entering `to` from another page of the signed-in shell (`from` is only for reading). */
const inShell = (to: string, _from: string, saved: { left: number; top: number } | null = null) => ({
  to,
  fromShell: true,
  saved,
})

describe('the tabs keep their place', () => {
  it('a tab opens where it was left; one never left opens at the top', () => {
    const places = createTabPlaces()
    places.leave('/', 420)
    expect(places.arrive(inShell('/library', '/'))).toEqual({ left: 0, top: 0 })
    places.leave('/library', 600)
    expect(places.arrive(inShell('/', '/library'))).toEqual({ left: 0, top: 420 })
    places.leave('/', 120)
    expect(places.arrive(inShell('/library', '/'))).toEqual({ left: 0, top: 600 })
    expect(places.arrive(inShell('/', '/library'))).toEqual({ left: 0, top: 120 })
  })

  it('a tab entered from a pushed page still opens where it was left', () => {
    const places = createTabPlaces()
    places.leave('/library', 600)
    places.leave('/book/b1', 300)
    expect(places.arrive(inShell('/library', '/book/b1'))).toEqual({ left: 0, top: 600 })
  })

  it('pushed pages open at the top and are not remembered', () => {
    const places = createTabPlaces()
    places.leave('/book/b1', 300)
    expect(places.arrive(inShell('/book/b1', '/'))).toEqual({ left: 0, top: 0 })
    expect(places.arrive(inShell('/collections', '/'))).toEqual({ left: 0, top: 0 })
  })

  it("back and forward use the browser's saved place, even over a tab's own", () => {
    const places = createTabPlaces()
    places.leave('/', 420)
    expect(places.arrive(inShell('/', '/book/b1', { left: 0, top: 380 }))).toEqual({ left: 0, top: 380 })
    expect(places.arrive(inShell('/book/b1', '/', { left: 0, top: 50 }))).toEqual({ left: 0, top: 50 })
  })

  it('coming in from outside the shell (signed out and back in) starts every tab at the top', () => {
    const places = createTabPlaces()
    places.leave('/', 420)
    places.leave('/library', 600)
    expect(places.arrive({ to: '/', fromShell: false, saved: null })).toEqual({ left: 0, top: 0 })
    expect(places.arrive(inShell('/library', '/'))).toEqual({ left: 0, top: 0 })
  })

  it('never remembers a place above the top', () => {
    const places = createTabPlaces()
    places.leave('/', -40)
    expect(places.arrive(inShell('/', '/library'))).toEqual({ left: 0, top: 0 })
  })
})

/**
 * A page that grows when told to, and a member who can take over: what the
 * router's document watch reports (app/router.options.ts), without a browser.
 */
function fakePage(height: number, viewport = 420) {
  const resized = new Set<() => void>()
  const member = new Set<() => void>()
  const page: PageWatch & { grow(to: number): void; touch(): void; watching(): number } = {
    maxTop: () => Math.max(0, height - viewport),
    onResize(changed) {
      resized.add(changed)
      return () => resized.delete(changed)
    },
    onMember(took) {
      member.add(took)
      return () => member.delete(took)
    },
    grow(to) {
      height = to
      for (const changed of [...resized]) changed()
    },
    touch() {
      for (const took of [...member]) took()
    },
    watching: () => resized.size + member.size,
  }
  return page
}

/** Where a wait stands: its answer once it has one, `pending` before. */
function settled(promise: Promise<Reach>) {
  let state: Reach | 'pending' = 'pending'
  void promise.then((reach) => (state = reach))
  return async () => {
    await Promise.resolve()
    return state
  }
}

describe('a place waits until its page is tall enough', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('lands at once on a page already tall enough', async () => {
    const page = fakePage(748)
    const { reached } = untilReachable({ left: 0, top: 328 }, page)
    expect(await reached).toBe('reachable')
    expect(page.watching()).toBe(0)
  })

  it('waits while the page is too short, and lands once it has grown', async () => {
    const page = fakePage(420)
    const state = settled(untilReachable({ left: 0, top: 328 }, page).reached)
    expect(await state()).toBe('pending')
    page.grow(600)
    expect(await state()).toBe('pending')
    page.grow(748)
    expect(await state()).toBe('reachable')
    expect(page.watching()).toBe(0)
  })

  it('gives up waiting after its patience, so the page lands as far down as it goes', async () => {
    const page = fakePage(420)
    const state = settled(untilReachable({ left: 0, top: 328 }, page).reached)
    vi.advanceTimersByTime(PLACE_PATIENCE - 1)
    expect(await state()).toBe('pending')
    vi.advanceTimersByTime(1)
    expect(await state()).toBe('patience')
    expect(page.watching()).toBe(0)
  })

  it('stops when the member scrolls herself, or a newer navigation takes over', async () => {
    const touched = fakePage(420)
    const byMember = settled(untilReachable({ left: 0, top: 328 }, touched).reached)
    touched.touch()
    expect(await byMember()).toBe('member')
    expect(touched.watching()).toBe(0)

    const superseded = fakePage(420)
    const wait = untilReachable({ left: 0, top: 328 }, superseded)
    const byNavigation = settled(wait.reached)
    wait.cancel()
    expect(await byNavigation()).toBe('cancelled')
    expect(superseded.watching()).toBe(0)
    // Nothing that happens afterwards changes the answer.
    superseded.grow(748)
    vi.advanceTimersByTime(PLACE_PATIENCE)
    expect(await byNavigation()).toBe('cancelled')
  })
})
