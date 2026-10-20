import { describe, expect, it } from 'vitest'
import { isOwnRefusal, refusedRead } from '../e2e/refusedRead'

/**
 * The one uncaught error the user flows excuse (e2e/fixtures.ts `noPageErrors`, e2e/refusedRead.ts): WebKit
 * refusing a read of this app's own. Both sides are pinned here: what it refuses is the app's own work, and
 * what it must not silence is a read that failed on any other host or in any other words.
 */

const refused = (url: string) => `Fetch API cannot load ${url} due to access control checks.`
const own = ['http://localhost:4327', 'http://127.0.0.1:55321']

describe('the address WebKit refused', () => {
  it('is read out of its own wording, and only out of it', () => {
    expect(refusedRead(refused('http://127.0.0.1:55321/rest/v1/accounts?select=avatar_path'))?.pathname).toBe('/rest/v1/accounts')
    expect(refusedRead(refused('http://localhost:4327/_nuxt/builds/latest.json?t=1792522156735'))?.hostname).toBe('localhost')
    // The CORS failure the wording really names is a message of its own, not this one.
    expect(refusedRead('Load failed')).toBeNull()
    expect(refusedRead('TypeError: fetch failed')).toBeNull()
    // WebKit's wording without its end, or said of something else, is not this refusal.
    expect(refusedRead('Fetch API cannot load http://localhost:4327/x due to access control checks')).toBeNull()
    expect(refusedRead('CORS request rejected: http://localhost:4327/x')).toBeNull()
    expect(refusedRead(refused('http://'))).toBeNull()
  })
})

describe('a refusal of this app’s own', () => {
  it('is excused for the app the flows are served and the stack they read', () => {
    expect(isOwnRefusal(refused('http://localhost:4327/_nuxt/builds/latest.json?t=1'), own)).toBe(true)
    expect(isOwnRefusal(refused('http://127.0.0.1:55321/auth/v1/health'), own)).toBe(true)
    expect(isOwnRefusal(refused('http://127.0.0.1:55321/rest/v1/library_entries?status=eq.reading'), own)).toBe(true)
    expect(isOwnRefusal(refused('http://127.0.0.1:55321/rest/v1/import_jobs?select=id%2Cstate&order=created_at.desc&limit=1'), own)).toBe(true)
    expect(isOwnRefusal(refused('http://127.0.0.1:55321/rest/v1/reading_sessions?select=id&outcome=eq.finished'), own)).toBe(true)
  })

  it('is excused whenever it came: a navigation, a close, an offline toggle or a route’s abort are all the app’s own doing', () => {
    // Nothing but the wording and the address decides it: run 39480808919's refusals came at a navigation,
    // at a close, at `context.setOffline` and at a `route.abort`, and no timing rule covered them all.
    expect(isOwnRefusal(refused('http://127.0.0.1:55321/auth/v1/health'), own)).toBe(true)
    expect(isOwnRefusal(`Error: ${refused('http://localhost:4327/_nuxt/builds/latest.json')}`)).toBe(false)
  })

  it('is never another host, however alike it looks', () => {
    // The origin a CORS refusal really names: the recordings' Apple and the cover CDNs.
    expect(isOwnRefusal(refused('https://itunes.apple.com/search?term=dune'), own)).toBe(false)
    expect(isOwnRefusal(refused('https://is1-ssl.mzstatic.com/image/thumb/1/240x360bb.jpg'), own)).toBe(false)
    expect(isOwnRefusal(refused('https://covers.openlibrary.org/b/id/1-M.jpg'), own)).toBe(false)
    // A local host on another port is another origin: nothing else of this machine is the app's to read.
    expect(isOwnRefusal(refused('http://127.0.0.1:3020/rest/v1/accounts'), own)).toBe(false)
    expect(isOwnRefusal(refused('http://localhost:55321/rest/v1/accounts'), own)).toBe(false)
    // Another address of the app's own origin is its own read, wherever it points.
    expect(isOwnRefusal(refused('http://localhost:4327/r/abc'), own)).toBe(true)
  })

  it('is never any other message, even from the app’s own origin', () => {
    expect(isOwnRefusal('Load failed', own)).toBe(false)
    expect(isOwnRefusal('AbortError: The operation was aborted.', own)).toBe(false)
    expect(isOwnRefusal('TypeError: Load failed', own)).toBe(false)
    expect(isOwnRefusal(`Error: ${refused('http://127.0.0.1:55321/rest/v1/accounts')}`, own)).toBe(false)
  })
})
