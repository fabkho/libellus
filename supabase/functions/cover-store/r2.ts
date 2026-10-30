/**
 * The covers bucket (`libellus-covers`, Cloudflare R2), written through the S3 API with a signed `PUT`
 * (`aws4fetch`, SigV4, region `auto`). Only this function writes; its token is **Object Read & Write on that bucket
 * only** (`R2_COVERS_*` secrets, never in the repo or the client). The Pages Function `/c/` reads through its binding.
 *
 * A PUT of the same bytes is one Class A operation and harmless, so a store never asks first (no `HEAD`): the
 * reservation (`cover_store_reserve`, runner.ts) is what keeps an upload off a key that GC is deleting.
 * `endpoint` is for the local stack's stand-in only (README.md); production is `https://<account>.r2.cloudflarestorage.com`.
 */
import { AwsClient } from 'aws4fetch'

export const COVERS_BUCKET = 'libellus-covers'
/** What the Pages Function sends with an image: our copies never change (the key is the bytes' HMAC). */
/** A PUT of a cover (~100 KB at most) answers in well under this. */
export const PUT_TIMEOUT_MS = 20_000
/** A DELETE or a LIST answers in well under this too (no body either way worth speaking of). */
export const DELETE_TIMEOUT_MS = 15_000
export const OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export class R2Error extends Error {
  constructor(readonly status: number | null, message: string) {
    super(message)
  }
}

export type R2 = {
  /** Stores one image at `c/<key>/<width>`; rejects with `R2Error`. */
  put: (key: string, width: number, bytes: Uint8Array, contentType: string, options?: { signal?: AbortSignal }) => Promise<void>
  /** Deletes `c/<key>/<width>`; rejects with `R2Error`. An object that is not there is deleted (S3 and R2 answer 204); a 404 is NOT taken for it (a wrong bucket answers 404 too: the row must stay). */
  delete: (key: string, width: number, options?: { signal?: AbortSignal }) => Promise<void>
  /** The widths stored under `c/<key>/` (a LIST by prefix: GC of an object whose widths the database never learnt); rejects with `R2Error`. */
  list: (key: string, options?: { signal?: AbortSignal }) => Promise<number[]>
}

export type R2Options = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket?: string
  endpoint?: string
  /** A PUT that does not answer in this time fails (`R2Error`, status null); the run's own signal ends it sooner. */
  timeoutMs?: number
  /** The same for a DELETE and a LIST. */
  deleteTimeoutMs?: number
  fetch?: (request: Request) => Promise<Response>
}

export const objectPath = (key: string, width: number) => `c/${key}/${width}`

export function createR2(options: R2Options): R2 {
  const aws = new AwsClient({ accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, service: 's3', region: 'auto' })
  const send = options.fetch ?? ((request: Request) => fetch(request))
  const base = (options.endpoint ?? `https://${options.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '')
  const bucket = options.bucket ?? COVERS_BUCKET
  /** One signed request with a timeout; the body is returned as text only when asked (a LIST), else dropped. */
  async function call(what: string, request: Request, signal: AbortSignal | undefined, readBody: boolean): Promise<{ status: number; text: string }> {
    let response: Response
    try {
      const limit = AbortSignal.timeout(options.deleteTimeoutMs ?? DELETE_TIMEOUT_MS)
      response = await send(new Request(request, { signal: signal ? AbortSignal.any([limit, signal]) : limit }))
    } catch (error) {
      throw new R2Error(null, `${what} failed: ${error instanceof Error ? error.name : 'error'}`)
    }
    // An error answer's body can carry the request's details: it is dropped, only the status is kept.
    if (!readBody || !response.ok) {
      await response.body?.cancel().catch(() => {})
      return { status: response.status, text: '' }
    }
    try {
      return { status: response.status, text: await response.text() }
    } catch (error) {
      throw new R2Error(null, `${what} failed: ${error instanceof Error ? error.name : 'error'}`)
    }
  }
  return {
    async put(key, width, bytes, contentType, { signal } = {}) {
      const signed = await aws.sign(`${base}/${bucket}/${objectPath(key, width)}`, {
        method: 'PUT',
        body: bytes as Uint8Array<ArrayBuffer>,
        headers: { 'content-type': contentType, 'cache-control': OBJECT_CACHE_CONTROL },
      })
      let response: Response
      try {
        const limit = AbortSignal.timeout(options.timeoutMs ?? PUT_TIMEOUT_MS)
        response = await send(new Request(signed, { signal: signal ? AbortSignal.any([limit, signal]) : limit }))
      } catch (error) {
        throw new R2Error(null, `put failed: ${error instanceof Error ? error.name : 'error'}`)
      }
      // The answer's body can carry the request's details: it is dropped, only the status is kept.
      await response.body?.cancel().catch(() => {})
      if (!response.ok) throw new R2Error(response.status, `put answered ${response.status}`)
    },
    async delete(key, width, { signal } = {}) {
      const signed = await aws.sign(`${base}/${bucket}/${objectPath(key, width)}`, { method: 'DELETE' })
      const { status } = await call('delete', signed, signal, false)
      if (status < 200 || status >= 300) throw new R2Error(status, `delete answered ${status}`)
    },
    async list(key, { signal } = {}) {
      const signed = await aws.sign(`${base}/${bucket}?list-type=2&prefix=${encodeURIComponent(`c/${key}/`)}&max-keys=100`, { method: 'GET' })
      const { status, text } = await call('list', signed, signal, true)
      if (status < 200 || status >= 300) throw new R2Error(status, `list answered ${status}`)
      // Keys are `c/<key>/<width>`: nothing else is read from the answer.
      const widths = [...text.matchAll(/<Key>c\/[0-9a-f]{32}\/(\d{1,4})<\/Key>/g)].map((match) => Number(match[1]))
      return [...new Set(widths)].sort((a, b) => a - b)
    },
  }
}
