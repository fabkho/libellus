import { describe, expect, it } from 'vitest'
import { scrubRoute, scrubText } from '../app/data/errorLog'

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
    expect(scrubRoute('/f/Xk3-abcDEF_123/')).toBe('/f/[token]/')
    expect(scrubRoute('/friends/7c9e6679-7425-40de-944b-e07fc1f90ae7/')).toBe('/friends/[member]/')
  })

  it('scrubs an id or a token wherever it stands in the path', () => {
    expect(scrubRoute('/friends/7c9e6679-7425-40de-944b-e07fc1f90ae7/x')).toBe('/friends/[member]/x')
    expect(scrubRoute('/f/Xk3-abcDEF_123/x')).toBe('/f/[token]/x')
    expect(scrubRoute('/a/f/Xk3-abcDEF_123')).toBe('/a/f/[token]')
    expect(scrubRoute('/x/7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe('/x/[id]')
  })

  it('keeps the other paths as they are', () => {
    expect(scrubRoute('/friends')).toBe('/friends')
    expect(scrubRoute('/friends/people')).toBe('/friends/people')
    expect(scrubRoute('/book/abc')).toBe('/book/abc')
    expect(scrubRoute('book/abc')).toBeNull()
  })
})

describe('scrubText', () => {
  const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

  it("scrubs a member's id and a follow token from a Nuxt 404 message and a stack", () => {
    expect(scrubText(`Page not found: /friends/${ID}/x`)).toBe('Page not found: /friends/[id]/x')
    expect(scrubText('Page not found: /f/Xk3-abcDEF_123/x')).toBe('Page not found: /f/[token]/x')
    expect(scrubText(`at load (https://libellus.app/f/Xk3-abcDEF_123?x=1:12:5)\nid ${ID.toUpperCase()}`)).toBe(
      'at load (https://libellus.app/f/[token]:12:5)\nid [id]',
    )
  })

  it('keeps the rest of the text', () => {
    expect(scrubText('Failed to fetch /friends/people')).toBe('Failed to fetch /friends/people')
  })
})
