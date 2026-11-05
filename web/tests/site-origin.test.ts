import { describe, expect, it } from 'vitest'
import { ALIAS_HOSTS, canonicalOrigin, CANONICAL_HOST, isSiteHost } from '~/utils/siteOrigin'

/**
 * betterreads.de is the main address; libellus.fabkho.dev stays an alias of the same app (docs/HOSTING.md, "Addresses").
 * A link made for someone else is built on the main one; nothing else is rewritten.
 */
describe('isSiteHost: both addresses of the instance', () => {
  it('knows the main address and the alias', () => {
    expect(CANONICAL_HOST).toBe('betterreads.de')
    expect(ALIAS_HOSTS).toContain('libellus.fabkho.dev')
    expect(isSiteHost('betterreads.de')).toBe(true)
    expect(isSiteHost('libellus.fabkho.dev')).toBe(true)
    expect(isSiteHost('LIBELLUS.fabkho.dev')).toBe(true)
  })

  it('knows nothing else, lookalikes included', () => {
    for (const host of ['localhost', '127.0.0.1', 'main.libellus-3q1.pages.dev', 'libellus-3q1.pages.dev', 'evilbetterreads.de', 'betterreads.de.evil.example', 'fabkho.dev', 'books.fabkho.dev', 'www.betterreads.de']) {
      expect(isSiteHost(host), host).toBe(false)
    }
  })
})

describe('canonicalOrigin: the origin of a link made for someone else', () => {
  it('is the main address on the main address and on the alias', () => {
    expect(canonicalOrigin('https://betterreads.de')).toBe('https://betterreads.de')
    expect(canonicalOrigin('https://libellus.fabkho.dev')).toBe('https://betterreads.de')
  })

  it('leaves every other origin as it is: local, a Pages preview, another instance of the code', () => {
    for (const origin of ['http://localhost:3020', 'http://localhost:4327', 'http://127.0.0.1:3020', 'https://main.libellus-3q1.pages.dev', 'https://libellus-3q1.pages.dev', 'https://books.example.org']) {
      expect(canonicalOrigin(origin), origin).toBe(origin)
    }
  })

  it('does not move a plain-http or other-port origin of those hosts (not the live site)', () => {
    expect(canonicalOrigin('http://libellus.fabkho.dev')).toBe('http://libellus.fabkho.dev')
    expect(canonicalOrigin('https://libellus.fabkho.dev:8443')).toBe('https://libellus.fabkho.dev:8443')
  })

  it('returns what is not an origin untouched', () => {
    expect(canonicalOrigin('')).toBe('')
    expect(canonicalOrigin('null')).toBe('null')
  })
})
