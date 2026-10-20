import { describe, expect, it } from 'vitest'
import { isRefusalOfTheLeavingPage, LEAVING_WINDOW_MS, refusedRead } from '../e2e/refusedRead'

/**
 * The one uncaught error the user flows excuse (e2e/fixtures.ts `noPageErrors`, e2e/refusedRead.ts): WebKit
 * refusing a read of this app's own as the page went. Both sides are pinned here: what it refuses is the
 * page going, and what it must not silence is a read that failed for any other reason or on any other host.
 */

const refused = (url: string) => `Fetch API cannot load ${url} due to access control checks.`
const at = 1_000_000

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

describe('a refusal is excused as the page going', () => {
  it('for an address of this app, when a navigation or a close came just before it', () => {
    expect(isRefusalOfTheLeavingPage(refused('http://127.0.0.1:55321/rest/v1/library_entries?status=eq.reading'), at, at - 1)).toBe(true)
    expect(isRefusalOfTheLeavingPage(refused('http://localhost:4327/_nuxt/builds/latest.json?t=1'), at, at)).toBe(true)
    expect(isRefusalOfTheLeavingPage(refused('http://127.0.0.1:55321/rest/v1/import_job_rows?job_id=eq.1'), at, at - LEAVING_WINDOW_MS)).toBe(true)
  })

  it('never for another host, however the page went', () => {
    // The recordings' Apple and the cover CDNs: the origin a CORS refusal really names is refused here.
    expect(isRefusalOfTheLeavingPage(refused('https://itunes.apple.com/search?term=dune'), at, at - 1)).toBe(false)
    expect(isRefusalOfTheLeavingPage(refused('https://covers.openlibrary.org/b/id/1-M.jpg'), at, at - 1)).toBe(false)
  })

  it('never while the page stands still, or long after it went', () => {
    expect(isRefusalOfTheLeavingPage(refused('http://127.0.0.1:55321/rest/v1/accounts'), at, null)).toBe(false)
    expect(isRefusalOfTheLeavingPage(refused('http://127.0.0.1:55321/rest/v1/accounts'), at, at - LEAVING_WINDOW_MS - 1)).toBe(false)
    // The page cannot refuse a read in answer to a navigation that had not started yet.
    expect(isRefusalOfTheLeavingPage(refused('http://127.0.0.1:55321/rest/v1/accounts'), at, at + 1)).toBe(false)
  })

  it('never for any other message, even with the page going', () => {
    expect(isRefusalOfTheLeavingPage('Load failed', at, at - 1)).toBe(false)
    expect(isRefusalOfTheLeavingPage('AbortError: The operation was aborted.', at, at - 1)).toBe(false)
    expect(isRefusalOfTheLeavingPage(refused('https://api.example.com/x'), at, at - 1)).toBe(false)
  })
})
