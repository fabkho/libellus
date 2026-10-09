import { describe, expect, it } from 'vitest'
import { scrubRoute } from '../app/data/errorLog'

/**
 * The route a client error report carries (data/errorLog.ts): the path, never its
 * query or fragment, and a member's id or a follow link's token replaced by the
 * route's pattern, so the owner's log never holds either.
 */
describe('scrubRoute', () => {
  it('replaces a member id and a follow token with their pattern', () => {
    expect(scrubRoute('/friends/7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe('/friends/[member]')
    expect(scrubRoute('/friends/7C9E6679-7425-40DE-944B-E07FC1F90AE7/2026')).toBe('/friends/[member]/2026')
    expect(scrubRoute('/f/Xk3-abcDEF_123')).toBe('/f/[token]')
    expect(scrubRoute('/f/Xk3-abcDEF_123?ref=mail#top')).toBe('/f/[token]')
  })

  it('keeps the other paths as they are', () => {
    expect(scrubRoute('/friends')).toBe('/friends')
    expect(scrubRoute('/friends/people')).toBe('/friends/people')
    expect(scrubRoute('/book/abc')).toBe('/book/abc')
    expect(scrubRoute('book/abc')).toBeNull()
  })
})
