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
export const OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export class R2Error extends Error {
  constructor(readonly status: number | null, message: string) {
    super(message)
  }
}

export type R2 = {
  /** Stores one image at `c/<key>/<width>`; rejects with `R2Error`. */
  put: (key: string, width: number, bytes: Uint8Array, contentType: string) => Promise<void>
}

export type R2Options = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket?: string
  endpoint?: string
  fetch?: (request: Request) => Promise<Response>
}

export const objectPath = (key: string, width: number) => `c/${key}/${width}`

export function createR2(options: R2Options): R2 {
  const aws = new AwsClient({ accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, service: 's3', region: 'auto' })
  const send = options.fetch ?? ((request: Request) => fetch(request))
  const base = (options.endpoint ?? `https://${options.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '')
  const bucket = options.bucket ?? COVERS_BUCKET
  return {
    async put(key, width, bytes, contentType) {
      const signed = await aws.sign(`${base}/${bucket}/${objectPath(key, width)}`, {
        method: 'PUT',
        body: bytes as Uint8Array<ArrayBuffer>,
        headers: { 'content-type': contentType, 'cache-control': OBJECT_CACHE_CONTROL },
      })
      let response: Response
      try {
        response = await send(signed)
      } catch (error) {
        throw new R2Error(null, `put failed: ${error instanceof Error ? error.name : 'error'}`)
      }
      // The answer's body can carry the request's details: it is dropped, only the status is kept.
      await response.body?.cancel().catch(() => {})
      if (!response.ok) throw new R2Error(response.status, `put answered ${response.status}`)
    },
  }
}
