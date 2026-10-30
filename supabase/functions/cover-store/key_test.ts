import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { coverKey } from './key.ts'
import { fixture } from './test_support.ts'

Deno.test('the key is the first 128 bits of HMAC-SHA256(secret, "v1:" + bytes), hex (checked against openssl)', async () => {
  // printf 'v1:abc' | openssl dgst -sha256 -hmac 'test-secret' -hex
  assertEquals(await coverKey('test-secret', new TextEncoder().encode('abc')), 'e0ab6483d47a1dd25bf0981466d5a64e')
})

Deno.test('a key is 32 hex characters, the same for the same bytes, another for another secret or other bytes', async () => {
  const large = fixture('apple-600x900.webp')
  const key = await coverKey('one', large)
  assert(/^[0-9a-f]{32}$/.test(key))
  assertEquals(await coverKey('one', large), key)
  assertNotEquals(await coverKey('two', large), key)
  assertNotEquals(await coverKey('one', fixture('apple-360x540.webp')), key)
})
