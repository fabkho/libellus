import { assertEquals } from '@std/assert'
import { createAuthorize, MIN_TOKEN_LENGTH, sameSecret, usableToken } from './authorize.ts'

const SERVICE = 'service-role-key-' + 'k'.repeat(40)
const TOKEN = 't'.repeat(MIN_TOKEN_LENGTH)

const asking = (authorization?: string) => new Request('http://localhost/catalogue-check', { method: 'POST', headers: authorization ? { authorization } : {} })

Deno.test('the service-role key and the shared secret pass; nothing else does', async () => {
  const authorize = createAuthorize(SERVICE, TOKEN)
  assertEquals(await authorize(asking(`Bearer ${SERVICE}`)), true)
  assertEquals(await authorize(asking(`bearer ${TOKEN}`)), true)
  assertEquals(await authorize(asking(`Bearer ${TOKEN}x`)), false)
  assertEquals(await authorize(asking(`Bearer ${TOKEN.slice(1)}`)), false)
  assertEquals(await authorize(asking(`Bearer ${'t'.repeat(MIN_TOKEN_LENGTH + 100)}`)), false, 'longer is not the same')
  assertEquals(await authorize(asking('Bearer ')), false)
  assertEquals(await authorize(asking(TOKEN)), true, 'the bare token is read as one (no scheme to strip)')
  assertEquals(await authorize(asking()), false)
  assertEquals(await authorize(asking('Bearer a-members-access-token')), false)
})

Deno.test('without a shared secret only the service-role key passes, and an empty one is never a match', async () => {
  const authorize = createAuthorize(SERVICE, null)
  assertEquals(await authorize(asking(`Bearer ${SERVICE}`)), true)
  assertEquals(await authorize(asking(`Bearer ${TOKEN}`)), false)
  assertEquals(await authorize(asking('Bearer')), false)
})

Deno.test('a shared secret under 32 characters is not one', () => {
  assertEquals(usableToken(undefined), null)
  assertEquals(usableToken(''), null)
  assertEquals(usableToken('short'), null)
  assertEquals(usableToken('x'.repeat(MIN_TOKEN_LENGTH - 1)), null)
  assertEquals(usableToken(`  ${TOKEN}\n`), TOKEN)
})

Deno.test('sameSecret compares the secrets, whatever their length', async () => {
  assertEquals(await sameSecret('abc', 'abc'), true)
  assertEquals(await sameSecret('abc', 'abd'), false)
  assertEquals(await sameSecret('', 'abc'), false)
  assertEquals(await sameSecret('', ''), true)
})
