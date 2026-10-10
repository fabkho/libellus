/**
 * Stand-ins: a `fetch` that answers the URLs a test names and fails any other (so a test can never
 * reach a real source), a clock that only moves when the code sleeps, and an in-memory store.
 */
import { type Clock, createHttp, type FetchLike, type Http } from '../enrich/http.ts'
import type { CheckBook, CheckResult } from './check.ts'
import { safeFetch } from './safe_fetch.ts'
import type { Store } from './store.ts'

export type Answer = unknown | Response | (() => Response | Promise<Response>)

export function answer(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A `fetch` over `routes` (full URL → body, a Response, or a function); every URL asked is kept, in order. */
export function routedFetch(routes: Record<string, Answer>) {
  const asked: string[] = []
  const fetch: FetchLike = (url) => {
    asked.push(url)
    const route = routes[url]
    if (route === undefined) return Promise.resolve(answer(404, { error: 'notfound' }))
    if (typeof route === 'function') return Promise.resolve((route as () => Response | Promise<Response>)())
    if (route instanceof Response) return Promise.resolve(route.clone())
    return Promise.resolve(answer(200, route))
  }
  return { fetch, asked }
}

/** A clock that only moves when the code sleeps. */
export function fakeClock(start = Date.parse('2026-10-21T10:00:00Z')): Clock & { advance: (ms: number) => void } {
  let time = start
  return {
    now: () => time,
    sleep: (ms) => {
      time += ms
      return Promise.resolve()
    },
    advance: (ms) => (time += ms),
  }
}

/** The real http client over `routes`, behind the real host allowlist, with no pauses. */
export function testHttp(routes: Record<string, Answer>, clock = fakeClock()): { http: Http; asked: string[] } {
  const { fetch, asked } = routedFetch(routes)
  return { http: createHttp({ fetch: safeFetch(fetch), userAgent: 'test', clock, intervals: {} }), asked }
}

export function book(overrides: Partial<CheckBook> = {}): CheckBook {
  return {
    id: crypto.randomUUID(),
    title: 'A Book',
    source: 'openlibrary',
    apple_id: null,
    isbn13: null,
    isbn10: null,
    openlibrary_edition_key: null,
    openlibrary_work_key: null,
    ...overrides,
  }
}

export type Memory = {
  queue: CheckBook[]
  saved: { id: string; result: CheckResult }[]
  missed: string[]
  failed: { id: string; error: string }[]
  released: string[]
  claims: number[]
}

export function memoryStore(queue: CheckBook[], options: { saveFails?: (id: string) => boolean } = {}): { store: Store; memory: Memory } {
  const memory: Memory = { queue: [...queue], saved: [], missed: [], failed: [], released: [], claims: [] }
  const store: Store = {
    claim: (limit) => {
      memory.claims.push(limit)
      return Promise.resolve(memory.queue.splice(0, limit))
    },
    save: (id, result) => {
      if (options.saveFails?.(id)) return Promise.reject(new Error('catalogue_check_save: boom'))
      memory.saved.push({ id, result })
      return Promise.resolve(true)
    },
    miss: (id) => {
      memory.missed.push(id)
      return Promise.resolve(true)
    },
    failed: (id, error) => {
      memory.failed.push({ id, error })
      return Promise.resolve()
    },
    release: (id) => {
      memory.released.push(id)
      return Promise.resolve()
    },
    status: () => Promise.resolve({ unchecked: memory.queue.length, checked: 0, failed: 0, backingOff: 0 }),
  }
  return { store, memory }
}
