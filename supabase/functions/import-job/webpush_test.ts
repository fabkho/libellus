import { assert, assertEquals, assertRejects } from '@std/assert'
import { base64url, encryptPayload, fromBase64url, generateVapidKeys, MAX_PAYLOAD_BYTES, sendPush, vapidAuthorization } from './webpush.ts'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** A key pair from the RFC's base64url scalar and point. */
async function pair(privateKey: string, publicKey: string, usage: 'ECDH' | 'ECDSA'): Promise<CryptoKeyPair> {
  const point = fromBase64url(publicKey)
  const jwk = { kty: 'EC', crv: 'P-256', x: base64url(point.slice(1, 33)), y: base64url(point.slice(33)), ext: true }
  const name = { name: usage, namedCurve: 'P-256' }
  return {
    privateKey: await crypto.subtle.importKey('jwk', { ...jwk, d: privateKey }, name, true, usage === 'ECDH' ? ['deriveBits'] : ['sign']),
    publicKey: await crypto.subtle.importKey('jwk', jwk, name, true, usage === 'ECDH' ? [] : ['verify']),
  }
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, secret: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bits: number) {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits))
}

/** What the browser does with a push message (RFC 8291 §3.4 and 8188), written out on its own: the test checks the sender against it. */
async function decrypt(body: Uint8Array<ArrayBuffer>, browser: CryptoKeyPair, authSecret: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const salt = body.slice(0, 16)
  assertEquals(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096, 'the record size')
  const keyLength = body[20]!
  assertEquals(keyLength, 65, 'the sender key is an uncompressed point')
  const sender = body.slice(21, 21 + keyLength)
  const record = body.slice(21 + keyLength)
  const receiver = new Uint8Array(await crypto.subtle.exportKey('raw', browser.publicKey))
  const senderKey = await crypto.subtle.importKey('raw', sender, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, browser.privateKey, 256))
  const info = new Uint8Array([...encoder.encode('WebPush: info\0'), ...receiver, ...sender])
  const keyMaterial = await hkdf(authSecret, shared, info, 256)
  const contentKey = await hkdf(salt, keyMaterial, encoder.encode('Content-Encoding: aes128gcm\0'), 128)
  const nonce = await hkdf(salt, keyMaterial, encoder.encode('Content-Encoding: nonce\0'), 96)
  const aes = await crypto.subtle.importKey('raw', contentKey, 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, record))
  assertEquals(plain[plain.length - 1], 2, 'the last record ends with the delimiter 0x02')
  return plain.slice(0, -1)
}

/** A browser's subscription: its key pair and the auth secret it hands the app. */
async function browser() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const auth = crypto.getRandomValues(new Uint8Array(16))
  const p256dh = base64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))
  return { keys, auth, target: { endpoint: 'https://push.example.test/send/abc', p256dh, auth: base64url(auth) } }
}

Deno.test('RFC 8291 appendix A: the message of the specification, byte for byte', async () => {
  const body = await encryptPayload(
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    encoder.encode('When I grow up, I want to be a watermelon'),
    {
      ephemeral: await pair(
        'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
        'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
        'ECDH',
      ),
      salt: fromBase64url('DGv6ra1nlYgDCS1FRnbzlw'),
    },
  )
  assertEquals(
    base64url(body),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  )
})

Deno.test('what is sent is what the browser reads: encrypted for it, with a fresh key and salt every time', async () => {
  const subscription = await browser()
  const message = JSON.stringify({ title: 'Import done', body: '12 Bücher zu deiner Bibliothek hinzugefügt', url: '/import' })
  const first = await encryptPayload(subscription.target, encoder.encode(message))
  const second = await encryptPayload(subscription.target, encoder.encode(message))
  assertEquals(decoder.decode(await decrypt(first, subscription.keys, subscription.auth)), message)
  assertEquals(decoder.decode(await decrypt(second, subscription.keys, subscription.auth)), message)
  assert(base64url(first) !== base64url(second), 'no two messages share a salt or a key')
  // Another browser's keys cannot read it.
  const other = await browser()
  await assertRejects(() => decrypt(first, other.keys, other.auth))
})

Deno.test('a message that does not fit one record, and keys that are not a browser\'s, are refused', async () => {
  const subscription = await browser()
  const full = await encryptPayload(subscription.target, new Uint8Array(MAX_PAYLOAD_BYTES))
  assertEquals(full.length, 21 + 65 + MAX_PAYLOAD_BYTES + 1 + 16, 'the largest message is the record size, header and tag included')
  await assertRejects(() => encryptPayload(subscription.target, new Uint8Array(MAX_PAYLOAD_BYTES + 1)), Error, 'payload_too_large')
  await assertRejects(() => encryptPayload({ ...subscription.target, auth: 'AAAA' }, encoder.encode('x')), Error, 'subscription_invalid')
  await assertRejects(() => encryptPayload({ ...subscription.target, p256dh: base64url(new Uint8Array(65).fill(7)) }, encoder.encode('x')))
})

Deno.test('the VAPID token: ES256 over the push service\'s origin, signed with the private key, checkable with the public one', async () => {
  const vapid = { ...(await generateVapidKeys()), subject: 'mailto:owner@example.test' }
  const now = Date.UTC(2026, 10, 6, 12, 0, 0)
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc?x=1', vapid, now)
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header)
  assert(match, header)
  const [, head, claims, signature, key] = match
  assertEquals(key, vapid.publicKey)
  assertEquals(JSON.parse(decoder.decode(fromBase64url(head!))), { typ: 'JWT', alg: 'ES256' })
  assertEquals(JSON.parse(decoder.decode(fromBase64url(claims!))), { aud: 'https://fcm.googleapis.com', exp: now / 1000 + 43200, sub: 'mailto:owner@example.test' })
  const point = fromBase64url(vapid.publicKey)
  const verifyKey = await crypto.subtle.importKey('raw', point, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  assertEquals(fromBase64url(signature!).length, 64, 'r || s, as a JWT has it')
  assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, fromBase64url(signature!), encoder.encode(`${head}.${claims}`)))
  assertEquals(point.length, 65)
  assertEquals(fromBase64url(vapid.privateKey).length, 32)
})

Deno.test('a send: one POST to the endpoint, the headers a push service wants, a body only that browser reads', async () => {
  const subscription = await browser()
  const vapid = { ...(await generateVapidKeys()), subject: 'mailto:owner@example.test' }
  const seen: { url: string; init: RequestInit }[] = []
  const answer = await sendPush(subscription.target, encoder.encode('{"title":"Import done"}'), {
    vapid,
    fetch: (input, init) => {
      seen.push({ url: String(input), init: init! })
      return Promise.resolve(new Response(null, { status: 201 }))
    },
  })
  assertEquals(answer, { status: 201 })
  assertEquals(seen.length, 1)
  assertEquals(seen[0]!.url, subscription.target.endpoint)
  const headers = seen[0]!.init.headers as Record<string, string>
  assertEquals(seen[0]!.init.method, 'POST')
  assertEquals(headers['content-encoding'], 'aes128gcm')
  assertEquals(headers['ttl'], '86400')
  assert(headers['authorization']!.startsWith('vapid t='))
  assertEquals(decoder.decode(await decrypt(seen[0]!.init.body as Uint8Array<ArrayBuffer>, subscription.keys, subscription.auth)), '{"title":"Import done"}')
})

Deno.test('the push service\'s answers come back as they are; a network failure is status 0, bad keys a 400', async () => {
  const subscription = await browser()
  const vapid = { ...(await generateVapidKeys()), subject: 'mailto:owner@example.test' }
  const payload = encoder.encode('{}')
  for (const status of [404, 410, 429, 500]) {
    assertEquals(await sendPush(subscription.target, payload, { vapid, fetch: () => Promise.resolve(new Response('gone', { status })) }), { status })
  }
  const down = await sendPush(subscription.target, payload, { vapid, fetch: () => Promise.reject(new TypeError('connection refused')) })
  assertEquals(down, { status: 0, error: 'connection refused' })
  const bad = await sendPush({ ...subscription.target, auth: 'x' }, payload, { vapid, fetch: () => Promise.reject(new Error('never asked')) })
  assertEquals(bad, { status: 400, error: 'subscription_invalid' })
})
