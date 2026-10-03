import { describe, expect, it } from 'vitest'
import { createTabPlaces } from '@/utils/tabPlaces'

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
