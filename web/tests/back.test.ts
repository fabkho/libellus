import { describe, expect, it } from 'vitest'
import { canGoBack } from '../app/utils/back'

/** The back rule of the pushed pages (utils/back.ts): through the history when there is a page before, else the fallback. */
describe('canGoBack', () => {
  it('goes back through the history from wherever the page was reached from', () => {
    for (const back of ['/', '/profile', '/friends', '/friends/some-member', '/library', '/book/abc']) {
      expect(canGoBack({ back })).toBe(true)
    }
  })

  it('falls back only for a page opened directly: nothing before it', () => {
    expect(canGoBack(null)).toBe(false)
    expect(canGoBack(undefined)).toBe(false)
    expect(canGoBack({})).toBe(false)
    expect(canGoBack({ back: null })).toBe(false)
    expect(canGoBack({ back: '' })).toBe(false)
  })
})
