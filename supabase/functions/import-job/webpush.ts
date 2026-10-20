/**
 * Web Push for Deno / Supabase Edge, on WebCrypto alone (no dependency, nothing of Node):
 *
 *   RFC 8030  the request: POST the message to the subscription's address with a TTL
 *   RFC 8291  the message: encrypted for one browser with its public key and auth secret (ECDH, HKDF, AES-128-GCM)
 *   RFC 8188  the content coding `aes128gcm` (one record: the payload stays far below its 4096 bytes)
 *   RFC 8292  VAPID: who is sending, a short-lived ES256 token and the public key in `Authorization: vapid t=…, k=…`
 *
 * `npm:web-push` is not used on purpose: it leans on Node's `https` and `crypto` streams, which the Edge runtime only
 * half has; this is a hundred lines the tests check in both directions (`webpush_test.ts` decrypts what it sends).
 *
 * Keys are the usual base64url: the VAPID public key is the 65-byte uncompressed P-256 point, the private key its 32-byte
 * scalar (what `vapid_keys.ts` prints, what `npx web-push generate-vapid-keys` prints, what the app's `applicationServerKey` is).
 */

/** What WebCrypto takes: bytes in a plain ArrayBuffer. */
type Bytes = Uint8Array<ArrayBuffer>

const encoder = new TextEncoder()

/** The largest message one record holds: 4096 − the 86-byte header − the 16-byte tag − the 1-byte delimiter. */
export const MAX_PAYLOAD_BYTES = 3993

export function base64url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function fromBase64url(text: string): Bytes {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  const raw = atob(padded)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
  return bytes
}

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** A VAPID key pair as the two base64url strings the function's secrets hold. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { publicKey: base64url(raw), privateKey: jwk.d! }
}

export type Vapid = {
  /** The 65-byte public key, base64url (the app's `applicationServerKey`). */
  publicKey: string
  /** The 32-byte private scalar, base64url. */
  privateKey: string
  /** `mailto:…` or an https address the push service can reach the sender at. */
  subject: string
}

/** The browser's subscription: what `PushSubscription.toJSON()` holds. */
export type PushTarget = { endpoint: string; p256dh: string; auth: string }

async function signingKey(vapid: Vapid): Promise<CryptoKey> {
  const point = fromBase64url(vapid.publicKey)
  if (point.length !== 65 || point[0] !== 4) throw new Error('VAPID_PUBLIC_KEY is not an uncompressed P-256 point')
  return await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: base64url(point.slice(1, 33)), y: base64url(point.slice(33)), d: vapid.privateKey, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
}

/** The `Authorization` header: a VAPID token for the push service's origin, good for 12 hours (the limit is 24). */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, nowMs: number = Date.now()): Promise<string> {
  const json = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)))
  const unsigned = `${json({ typ: 'JWT', alg: 'ES256' })}.${json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  })}`
  // ECDSA through WebCrypto answers r || s (64 bytes), which is what a JWT's ES256 signature is.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(vapid), encoder.encode(unsigned)))
  return `vapid t=${unsigned}.${base64url(signature)}, k=${vapid.publicKey}`
}

async function hkdf(salt: Bytes, secret: Bytes, info: Bytes, bits: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits))
}

/**
 * The body of the request: RFC 8188's header (salt, record size, the sender's key) and the one encrypted record.
 * `ephemeral` and `salt` are for the tests (a fixed pair); sending makes fresh ones every time.
 */
export async function encryptPayload(
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  payload: Uint8Array,
  fresh: { ephemeral?: CryptoKeyPair; salt?: Bytes } = {},
): Promise<Bytes> {
  if (payload.length > MAX_PAYLOAD_BYTES) throw new Error('payload_too_large')
  let receiver: Bytes
  let authSecret: Bytes
  try {
    receiver = fromBase64url(target.p256dh)
    authSecret = fromBase64url(target.auth)
  } catch {
    throw new Error('subscription_invalid')
  }
  if (receiver.length !== 65 || receiver[0] !== 4 || authSecret.length !== 16) throw new Error('subscription_invalid')
  const ephemeral = fresh.ephemeral ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']))
  const salt = fresh.salt ?? crypto.getRandomValues(new Uint8Array(16))
  const sender = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
  const receiverKey = await crypto.subtle.importKey('raw', receiver, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, ephemeral.privateKey, 256))
  // RFC 8291 §3.4: the input keying material mixes the browser's auth secret with both public keys.
  const keyMaterial = await hkdf(authSecret, shared, concat(encoder.encode('WebPush: info\0'), receiver, sender), 256)
  const contentKey = await hkdf(salt, keyMaterial, encoder.encode('Content-Encoding: aes128gcm\0'), 128)
  const nonce = await hkdf(salt, keyMaterial, encoder.encode('Content-Encoding: nonce\0'), 96)
  const aes = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['encrypt'])
  // The single record's last byte is the delimiter 0x02 (RFC 8188 §2): no padding after it.
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))))
  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = sender.length
  return concat(header, sender, record)
}

/** What the push service answered: 201 it took the message; 404 and 410 the subscription is gone for good. 0: it could not be reached. */
export type PushAnswer = { status: number; error?: string }

export type SendOptions = {
  vapid: Vapid
  /** How long the push service keeps the message for a browser that is off (seconds). */
  ttl?: number
  /** `very-low` … `high` (RFC 8030 §5.3). */
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  fetch?: typeof fetch
  now?: () => number
}

/** Sends one message to one browser. Never throws for the push service's answer; a network failure is status 0. */
export async function sendPush(target: PushTarget, payload: Uint8Array, options: SendOptions): Promise<PushAnswer> {
  const { vapid, ttl = 24 * 60 * 60, urgency = 'normal' } = options
  const doFetch = options.fetch ?? fetch
  let request: { headers: Record<string, string>; body: Bytes }
  try {
    request = {
      body: await encryptPayload(target, payload),
      headers: {
        authorization: await vapidAuthorization(target.endpoint, vapid, options.now?.()),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(ttl),
        urgency,
      },
    }
  } catch (error) {
    // Her subscription cannot carry a message (keys of the wrong size): it is no use to anyone.
    return { status: 400, error: error instanceof Error ? error.message : String(error) }
  }
  try {
    const answer = await doFetch(target.endpoint, { method: 'POST', headers: request.headers, body: request.body })
    // The answer's body is read and dropped so the connection is freed.
    await answer.body?.cancel()
    return { status: answer.status }
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) }
  }
}
