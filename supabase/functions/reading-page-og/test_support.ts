/**
 * What the tests need and the function does not: a stand-in for the database
 * and the cover hosts, and a reader for the PNG header. Nothing here reaches
 * the network — a request to an address the test did not plan for fails the
 * test rather than leaving the process.
 */
import { decodeBase64 } from '@std/encoding/base64'
import type { FetchLike } from './render.ts'

/** A 2×3 PNG in the lamp colour: a cover host's answer in the tests. */
export const TINY_PNG = decodeBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEElEQVR4nGPYUqEBRAwoFABXCQf5h5XBIQAAAABJRU5ErkJggg==',
)

export const STACK_URL = 'http://stack.test'
export const ANON_KEY = 'anon-key-for-tests'

export type StubPlan = {
  /** What `public_reading_page` answers; `undefined` means it is never asked. */
  page?: unknown
  /** What `public_book_card` answers. */
  card?: unknown
  /** How a cover host answers: a PNG, a refusal, or a request that never ends. */
  cover?: 'png' | 'error' | 'not-found' | 'hang'
  /** The database refuses: a 500 from PostgREST. */
  rpcStatus?: number
}

/** The requests a stub answered, so a test can assert what was asked. */
export type Stub = { fetch: FetchLike; asked: string[] }

export function stubFetch(plan: StubPlan): Stub {
  const asked: string[] = []
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body ?? null), { status, headers: { 'content-type': 'application/json' } })

  const fetch: FetchLike = (input, init) => {
    const url = String(input)
    asked.push(url)
    if (url.includes('/rest/v1/rpc/')) {
      if (plan.rpcStatus && plan.rpcStatus !== 200) return Promise.resolve(json({ message: 'nope' }, plan.rpcStatus))
      return Promise.resolve(json(url.endsWith('public_book_card') ? (plan.card ?? null) : (plan.page ?? null)))
    }
    if (url.startsWith('https://')) {
      if (plan.cover === 'error') return Promise.reject(new TypeError('cover host unreachable'))
      if (plan.cover === 'not-found') return Promise.resolve(new Response('gone', { status: 404 }))
      if (plan.cover === 'hang') {
        // Answers only when the render gives up: the abort signal it passed.
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }
      return Promise.resolve(new Response(TINY_PNG, { headers: { 'content-type': 'image/png' } }))
    }
    return Promise.reject(new Error(`the test did not plan for ${url}`))
  }
  return { fetch, asked }
}

/** The size a PNG says it is, read out of its IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** The eight bytes every PNG starts with. */
export function isPng(bytes: Uint8Array): boolean {
  return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
}

export function readFixture(name: string): unknown {
  return JSON.parse(Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
}
