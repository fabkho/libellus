import { assert, assertEquals } from '@std/assert'
import { createCallerCheck, presentsServiceKey, sameSecret } from './caller.ts'

const SERVICE_KEY = 'sb_secret_stand-in'
// What the platform's gateway puts on `Authorization` in place of a `Bearer sb_…` (`sb_api_key_compatibility: minted`).
const MINTED = 'eyJhbGciOiJFUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.minted'
const MEMBER_TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJtZW1iZXItMSJ9.member'

const request = (headers: Record<string, string>) => new Request('https://example.test/functions/v1/x', { method: 'POST', headers })

function check() {
  const asked: string[] = []
  const authorize = createCallerCheck({
    serviceKey: SERVICE_KEY,
    member: (token) => {
      asked.push(token)
      return Promise.resolve(token === MEMBER_TOKEN ? 'member-1' : null)
    },
  })
  return { authorize, asked }
}

Deno.test('sameSecret: equal secrets match, anything else does not', async () => {
  assert(await sameSecret('s3cret', 's3cret'))
  assert(!(await sameSecret('', 's3cret')))
  assert(!(await sameSecret('s3cret ', 's3cret')))
  assert(!(await sameSecret('s3cre', 's3cret')))
  assert(!(await sameSecret('a', 'b')))
})

Deno.test('the service role in production: its secret key on apikey, a minted JWT on Authorization', async () => {
  const { authorize, asked } = check()
  assertEquals(await authorize(request({ apikey: SERVICE_KEY, authorization: `Bearer ${MINTED}` })), { member: null })
  assertEquals(asked, [], 'the service role is no member: Auth is not asked')
})

Deno.test('the service role locally: the key as the bearer token (the legacy JWT key, the CLI stack, warm_library.ts)', async () => {
  const { authorize } = check()
  assertEquals(await authorize(request({ authorization: `Bearer ${SERVICE_KEY}` })), { member: null })
  assertEquals(await authorize(request({ apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` })), { member: null })
})

Deno.test('a member: her access token on Authorization, the publishable key on apikey', async () => {
  const { authorize, asked } = check()
  assertEquals(await authorize(request({ apikey: 'sb_publishable_x', authorization: `Bearer ${MEMBER_TOKEN}` })), { member: 'member-1' })
  assertEquals(asked, [MEMBER_TOKEN])
})

Deno.test('anybody else is refused: a wrong key, the publishable key alone, a minted JWT without the key, nothing', async () => {
  const { authorize } = check()
  assertEquals(await authorize(request({ apikey: 'sb_secret_wrong', authorization: `Bearer ${MINTED}` })), null)
  assertEquals(await authorize(request({ apikey: 'sb_publishable_x', authorization: 'Bearer sb_publishable_x' })), null)
  assertEquals(await authorize(request({ authorization: `Bearer ${MINTED}` })), null)
  assertEquals(await authorize(request({ apikey: `${SERVICE_KEY} ` + 'x' })), null)
  assertEquals(await authorize(request({})), null)
})

Deno.test('presentsServiceKey: only the exact key, on either header', async () => {
  assert(await presentsServiceKey(request({ apikey: SERVICE_KEY }), SERVICE_KEY))
  assert(await presentsServiceKey(request({ authorization: `bearer ${SERVICE_KEY}` }), SERVICE_KEY))
  assert(!(await presentsServiceKey(request({ apikey: SERVICE_KEY.slice(0, -1) }), SERVICE_KEY)))
  assert(!(await presentsServiceKey(request({}), SERVICE_KEY)))
})
