import { describe, expect, it } from 'vitest'
import type { FetchLike } from '@/data/fetching'
import { accessTokenOf, DIRECT_GAP_MS, viaOwnServer } from '@/data/openLibraryProxy'

/**
 * The import's fetch through its own server (data/openLibraryProxy.ts): Open Library rewritten
 * to the `openlibrary` function with the member's token, everything else untouched, and the
 * fallback to direct Open Library at one request a second when the function fails. Stubs only:
 * no test here reaches a host.
 */

const FUNCTION = 'https://acme.supabase.co/functions/v1/openlibrary'
const SEARCH = 'https://openlibrary.org/search.json?q=der+roman&limit=20&fields=key,title'

type Asked = { url: string; headers: Record<string, string>; signal?: AbortSignal }

function stub(answers: (url: string) => { status: number; retryAfter?: string } | 'reject' | 'abort') {
  const asked: Asked[] = []
  const fetch: FetchLike = async (url, init) => {
    asked.push({ url, headers: { ...(init as { headers?: Record<string, string> } | undefined)?.headers }, signal: init?.signal })
    const answer = answers(url)
    if (answer === 'reject') throw new TypeError('fetch failed')
    if (answer === 'abort') throw new DOMException('The search was replaced by a newer one', 'AbortError')
    return {
      ok: answer.status < 400,
      status: answer.status,
      json: async () => ({}),
      headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? (answer.retryAfter ?? null) : null) },
    }
  }
  return { fetch, asked }
}

/** A clock and a wait that only move when the code waits, and say how long it waited. */
function clock() {
  let time = 1_000_000
  const slept: number[] = []
  return {
    slept,
    now: () => time,
    wait: (ms: number) => {
      slept.push(ms)
      time += ms
      return Promise.resolve()
    },
  }
}

function setup(answers: (url: string) => { status: number; retryAfter?: string } | 'reject' | 'abort', token: string | (() => Promise<string | null>) = 'token-1') {
  const inner = stub(answers)
  const timed = clock()
  const wrapped = viaOwnServer(inner.fetch, { functionUrl: FUNCTION, token, apikey: 'anon-key', now: timed.now, wait: timed.wait })
  return { ...inner, wrapped, slept: timed.slept }
}

describe('through the function', () => {
  it('rewrites an Open Library ask to the function, with the path, the query and the token', async () => {
    const { wrapped, asked } = setup(() => ({ status: 200 }))
    const answer = await wrapped(SEARCH, { signal: undefined })
    expect(answer.status).toBe(200)
    expect(asked).toHaveLength(1)
    const to = new URL(asked[0]!.url)
    expect(to.origin + to.pathname).toBe(FUNCTION)
    expect(to.searchParams.get('path')).toBe('/search.json')
    expect(to.searchParams.get('q')).toBe('der roman')
    expect(to.searchParams.get('limit')).toBe('20')
    expect(asked[0]!.headers.authorization).toBe('Bearer token-1')
    expect(asked[0]!.headers.apikey).toBe('anon-key')
  })

  it('takes the token at call time, so a refreshed session is what is sent', async () => {
    let session = 'first'
    const { wrapped, asked } = setup(() => ({ status: 200 }), async () => session)
    await wrapped(SEARCH)
    session = 'second'
    await wrapped(SEARCH)
    expect(asked.map((call) => call.headers.authorization)).toEqual(['Bearer first', 'Bearer second'])
  })

  it('passes everything else by: Apple, and Open Library cover images', async () => {
    const { wrapped, asked } = setup(() => ({ status: 200 }))
    const apple = 'https://itunes.apple.com/search?term=der+roman&entity=ebook'
    const cover = 'https://covers.openlibrary.org/b/id/12345-L.jpg'
    await wrapped(apple)
    await wrapped(cover)
    expect(asked.map((call) => call.url)).toEqual([apple, cover])
    expect(asked[0]!.headers.authorization).toBeUndefined()
    expect(asked[1]!.headers.authorization).toBeUndefined()
  })
})

describe('the fallback to direct Open Library', () => {
  /** What the function answers vs what Open Library answers direct (a fallback needs the second to work). */
  const failures: [string, { status: number; retryAfter?: string } | 'reject', boolean][] = [
    ['the function is unreachable', 'reject', true],
    ['the function turns the member away (401)', { status: 401 }, true],
    ['the function fails (502)', { status: 502 }, true],
    ['the function is slow (504)', { status: 504 }, true],
    ['the function is refused for over a minute', { status: 429, retryAfter: '120' }, true],
    ['Open Library has not got the book (404)', { status: 404 }, false],
    ['Open Library is busy through us (503)', { status: 503, retryAfter: '5' }, false],
    ['Open Library refuses for a moment (429)', { status: 429, retryAfter: '30' }, false],
  ]
  for (const [name, viaFunction, falls] of failures) {
    it(`${falls ? 'goes direct when' : 'stays with the function when'} ${name}`, async () => {
      const { wrapped, asked, slept } = setup((url) => (new URL(url).hostname === 'acme.supabase.co' ? viaFunction : { status: 200 }))
      await wrapped(SEARCH)
      const after = asked.length
      expect(wrapped.fallbackActive()).toBe(falls)
      await wrapped(SEARCH)
      if (!falls) {
        // Still through the function, and nothing was waited out.
        expect(asked.length).toBe(after + 1)
        const to = new URL(asked.at(-1)!.url)
        expect(to.origin + to.pathname).toBe(FUNCTION)
        expect(slept).toEqual([])
        return
      }
      // The failed ask went direct at once (so the row gets its answer), and the next one follows it there.
      expect(new URL(asked[after - 1]!.url).hostname).toBe('openlibrary.org')
      expect(new URL(asked.at(-1)!.url).hostname).toBe('openlibrary.org')
    })
  }

  it('paces the direct way at one request a second, for the rest of the run', async () => {
    const { wrapped, asked, slept } = setup((url) => (new URL(url).hostname === 'acme.supabase.co' ? 'reject' : { status: 200 }))
    await wrapped(SEARCH)
    await wrapped(SEARCH)
    await wrapped(SEARCH)
    // The function once (it failed), then direct: the retry and the next two asks.
    expect(asked.map((call) => new URL(call.url).hostname)).toEqual(['acme.supabase.co', 'openlibrary.org', 'openlibrary.org', 'openlibrary.org'])
    // The first direct ask is the failed one's retry, at once; the next two keep their distance.
    expect(slept).toEqual([0, DIRECT_GAP_MS, DIRECT_GAP_MS])
  })

  it('a query the caller replaces is not the function failing', async () => {
    const { wrapped, asked } = setup(() => 'abort')
    await expect(wrapped(SEARCH)).rejects.toThrow('replaced')
    expect(wrapped.fallbackActive()).toBe(false)
    expect(asked).toHaveLength(1)
    expect(new URL(asked[0]!.url).hostname).toBe('acme.supabase.co')
  })

  it('a cover image probe after the fallback still goes direct and untouched', async () => {
    const { wrapped, asked } = setup((url) => (new URL(url).hostname === 'acme.supabase.co' ? 'reject' : { status: 200 }))
    await wrapped(SEARCH)
    const cover = 'https://covers.openlibrary.org/b/isbn/9780142437247-L.jpg?default=false'
    await wrapped(cover)
    expect(asked.at(-1)!.url).toBe(cover)
  })
})

describe('accessTokenOf', () => {
  it('is the session of the Supabase client, or null without one', async () => {
    const token = accessTokenOf({
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'live-token' } } }),
      },
    })
    expect(await token()).toBe('live-token')
    const signedOut = accessTokenOf({ auth: { getSession: async () => ({ data: { session: null } }) } })
    expect(await signedOut()).toBeNull()
  })
})
