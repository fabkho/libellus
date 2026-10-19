import { describe, expect, it } from 'vitest'
import type { FetchLike } from '@/data/fetching'
import { accessTokenOf, DIRECT_GAP_MS, FALLBACK_COOLDOWN_MS, FAILURES_BEFORE_FALLBACK, RETRY_AFTER_CAP_MS, RETRY_BACKOFF_MS, viaOwnServer } from '@/data/openLibraryProxy'

/**
 * The import's fetch through its own server (data/openLibraryProxy.ts): Open Library rewritten
 * to the `openlibrary` function with the member's token, everything else untouched, and the
 * retry and fallback to direct Open Library at one request a second when the function keeps failing, and the way back. Stubs only:
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

type Answer = { status: number; retryAfter?: string } | 'reject' | 'abort'
const isFunction = (url: string) => new URL(url).hostname === 'acme.supabase.co'
const hosts = (asked: Asked[]) => asked.map((call) => (isFunction(call.url) ? 'function' : new URL(call.url).hostname === 'openlibrary.org' ? 'direct' : 'other'))

/** A function that answers from a script (`up` flips it), Open Library direct always 200. */
function scripted(initial: Answer) {
  let viaFunction = initial
  const timed = clock()
  const inner = stub((url) => (isFunction(url) ? viaFunction : { status: 200 }))
  const wrapped = viaOwnServer(inner.fetch, { functionUrl: FUNCTION, token: 't', now: timed.now, wait: timed.wait })
  return { ...inner, wrapped, timed, answers: (next: Answer) => (viaFunction = next) }
}

describe('a failed request is not a broken function', () => {
  const failing: [string, Answer][] = [
    ['504 openlibrary_timeout', { status: 504 }],
    ['502 unreachable', { status: 502 }],
    ['a network error', 'reject'],
  ]
  for (const [name, failure] of failing) {
    it(`one ${name} is asked again through the function, with no fallback`, async () => {
      const { wrapped, asked, timed, answers } = scripted(failure)
      // The first ask fails, then the function answers.
      const first = wrapped(SEARCH)
      answers({ status: 200 })
      // (the stub answers per call: the first call already got the failure)
      expect((await first).status).toBe(200)
      expect(hosts(asked)).toEqual(['function', 'function'])
      expect(wrapped.fallbackActive()).toBe(false)
      expect(timed.slept).toEqual([RETRY_BACKOFF_MS[0]])
      expect(wrapped.stats()).toMatchObject({ functionFailures: 1, retries: 1, fallbacks: 0, directRequests: 0 })
    })
  }

  it('a success between failures resets the count: failures that are not in a row never fall back', async () => {
    let call = 0
    const timed = clock()
    const inner = stub((url) => (isFunction(url) ? (call++ % 3 === 2 ? { status: 200 } : { status: 504 }) : { status: 200 }))
    const wrapped = viaOwnServer(inner.fetch, { functionUrl: FUNCTION, token: 't', now: timed.now, wait: timed.wait })
    // Two failures then an answer, three times over: each ask succeeds on its third try.
    for (let i = 0; i < 3; i++) expect((await wrapped(SEARCH)).status).toBe(200)
    expect(wrapped.fallbackActive()).toBe(false)
    expect(hosts(inner.asked).every((host) => host === 'function')).toBe(true)
    expect(wrapped.stats()).toMatchObject({ functionFailures: 6, retries: 6, fallbacks: 0 })
  })

  it(`${FAILURES_BEFORE_FALLBACK} failures in a row go direct, and the failed ask is answered from there`, async () => {
    const { wrapped, asked, timed } = scripted({ status: 504 })
    const answer = await wrapped(SEARCH)
    expect(answer.status).toBe(200)
    expect(hosts(asked)).toEqual(['function', 'function', 'function', 'direct'])
    expect(wrapped.fallbackActive()).toBe(true)
    // Backoff 0.5 s, then 1 s, then the direct ask goes at once.
    expect(timed.slept).toEqual([...RETRY_BACKOFF_MS, 0])
    expect(wrapped.stats()).toMatchObject({ functionFailures: 3, retries: 2, fallbacks: 1, directRequests: 1 })
    // The next ask goes direct without trying the function.
    await wrapped(SEARCH)
    expect(hosts(asked).slice(4)).toEqual(['direct'])
  })

  it('failures counted across asks (parallel rows) fall back too', async () => {
    const { wrapped } = scripted({ status: 504 })
    // Three asks at once: each fails once, the third failure in a row goes direct.
    const answers = await Promise.all([wrapped(SEARCH), wrapped(SEARCH), wrapped(SEARCH)])
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200])
    expect(wrapped.fallbackActive()).toBe(true)
    expect(wrapped.stats().fallbacks).toBe(1)
  })

  it('waits out a Retry-After the failed answer names (capped), at least the backoff', async () => {
    const { wrapped, timed, answers } = scripted({ status: 502, retryAfter: '3' })
    const asking = wrapped(SEARCH)
    answers({ status: 200 })
    await asking
    expect(timed.slept).toEqual([3000])

    const capped = scripted({ status: 502, retryAfter: '120' })
    const cappedAsk = capped.wrapped(SEARCH)
    capped.answers({ status: 200 })
    await cappedAsk
    expect(capped.timed.slept).toEqual([RETRY_AFTER_CAP_MS])

    const small = scripted({ status: 502, retryAfter: '0.1' })
    const smallAsk = small.wrapped(SEARCH)
    small.answers({ status: 200 })
    await smallAsk
    expect(small.timed.slept).toEqual([RETRY_BACKOFF_MS[0]])
  })

  it('a query replaced while waiting for the retry ends the ask, not the function', async () => {
    const timed = clock()
    const inner = stub((url) => (isFunction(url) ? { status: 504 } : { status: 200 }))
    const wrapped = viaOwnServer(inner.fetch, {
      functionUrl: FUNCTION,
      token: 't',
      now: timed.now,
      wait: () => Promise.reject(new DOMException('replaced', 'AbortError')),
    })
    await expect(wrapped(SEARCH)).rejects.toThrow('replaced')
    expect(wrapped.fallbackActive()).toBe(false)
  })
})

describe('the way back to the function', () => {
  it('after the cooldown one ask tries the function again; on an answer the import is back on it', async () => {
    const { wrapped, asked, timed, answers } = scripted({ status: 504 })
    await wrapped(SEARCH)
    expect(wrapped.fallbackActive()).toBe(true)
    answers({ status: 200 })

    // Inside the cooldown the function is not asked.
    timed.wait(FALLBACK_COOLDOWN_MS - 1000)
    await wrapped(SEARCH)
    expect(hosts(asked).at(-1)).toBe('direct')
    expect(wrapped.fallbackActive()).toBe(true)

    // Past it: the function.
    timed.wait(2000)
    const before = asked.length
    expect((await wrapped(SEARCH)).status).toBe(200)
    expect(hosts(asked).slice(before)).toEqual(['function'])
    expect(wrapped.fallbackActive()).toBe(false)
    await wrapped(SEARCH)
    expect(hosts(asked).at(-1)).toBe('function')
    const stats = wrapped.stats()
    expect(stats).toMatchObject({ fallbacks: 1, recoveries: 1 })
    expect(stats.directMs).toBeGreaterThanOrEqual(FALLBACK_COOLDOWN_MS)
  })

  it('a probe that fails goes direct again for another cooldown, without retries', async () => {
    const { wrapped, asked, timed } = scripted({ status: 504 })
    await wrapped(SEARCH)
    timed.wait(FALLBACK_COOLDOWN_MS)
    const before = asked.length
    expect((await wrapped(SEARCH)).status).toBe(200)
    // One try at the function, then direct for the ask itself.
    expect(hosts(asked).slice(before)).toEqual(['function', 'direct'])
    expect(wrapped.fallbackActive()).toBe(true)
    expect(wrapped.stats().fallbacks).toBe(1)
    // The cooldown starts over: the next ask stays direct.
    await wrapped(SEARCH)
    expect(hosts(asked).at(-1)).toBe('direct')
    timed.wait(FALLBACK_COOLDOWN_MS)
    await wrapped(SEARCH)
    expect(hosts(asked).at(-2)).toBe('function')
  })

  it('asks that run beside a probe stay direct', async () => {
    const { wrapped, asked, timed } = scripted({ status: 504 })
    await wrapped(SEARCH)
    timed.wait(FALLBACK_COOLDOWN_MS)
    const before = asked.length
    await Promise.all([wrapped(SEARCH), wrapped(SEARCH)])
    expect(hosts(asked).slice(before).filter((host) => host === 'function')).toHaveLength(1)
  })
})

describe('the fallback to direct Open Library', () => {
  /** What the function answers vs what Open Library answers direct (a fallback needs the second to work). */
  const failures: [string, Answer, boolean][] = [
    ['the function turns the member away (401)', { status: 401 }, true],
    ['the function is refused for over a minute', { status: 429, retryAfter: '120' }, true],
    ['Open Library has not got the book (404)', { status: 404 }, false],
    ['Open Library is busy through us (503)', { status: 503, retryAfter: '5' }, false],
    ['Open Library refuses for a moment (429)', { status: 429, retryAfter: '30' }, false],
  ]
  for (const [name, viaFunction, falls] of failures) {
    it(`${falls ? 'goes direct at once when' : 'stays with the function when'} ${name}`, async () => {
      const { wrapped, asked, timed } = scripted(viaFunction)
      await wrapped(SEARCH)
      const after = asked.length
      expect(wrapped.fallbackActive()).toBe(falls)
      await wrapped(SEARCH)
      if (!falls) {
        // Still through the function, no retry, and nothing was waited out.
        expect(hosts(asked)).toEqual(['function', 'function'])
        expect(timed.slept).toEqual([])
        return
      }
      // The failed ask went direct at once (so the row gets its answer, no retry), and the next one follows it there.
      expect(hosts(asked)).toEqual(['function', 'direct', 'direct'])
      expect(after).toBe(2)
    })
  }

  it('paces the direct way at one request a second', async () => {
    const { wrapped, asked, timed } = scripted({ status: 401 })
    await wrapped(SEARCH)
    await wrapped(SEARCH)
    await wrapped(SEARCH)
    expect(hosts(asked)).toEqual(['function', 'direct', 'direct', 'direct'])
    // The first direct ask is the failed one's retry, at once; the next two keep their distance.
    expect(timed.slept).toEqual([0, DIRECT_GAP_MS, DIRECT_GAP_MS])
  })

  it('a query the caller replaces is not the function failing', async () => {
    const { wrapped, asked } = setup(() => 'abort')
    await expect(wrapped(SEARCH)).rejects.toThrow('replaced')
    expect(wrapped.fallbackActive()).toBe(false)
    expect(wrapped.stats().functionFailures).toBe(0)
    expect(asked).toHaveLength(1)
    expect(new URL(asked[0]!.url).hostname).toBe('acme.supabase.co')
  })

  it('a cover image probe after the fallback still goes direct and untouched', async () => {
    const { wrapped, asked } = scripted({ status: 401 })
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
