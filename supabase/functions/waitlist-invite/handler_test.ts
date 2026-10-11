/**
 * The function's behaviour (issue #171) with a stand-in database and mailer: an invite is mailed
 * and only then marked; without SMTP or with a failed send nothing is marked and the code still
 * comes back; the database's refusals become 403 and 404; a request without a session or an entry
 * id is refused before anything is asked; and no log line carries the address or the code.
 *
 *   cd supabase/functions/waitlist-invite && deno task test
 */
import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert'
import { createHandler, type Database, DatabaseRefusal, failureKind, type HandlerDeps } from './handler.ts'
import type { Mail, Mailer } from './mail.ts'

const ID = '6f1c1c39-5a64-4c39-9a3e-2c1f1a0b9d11'
const EMAIL = 'reader@example.org'
const CODE = 'K7QM-X2PA'
const EXPIRES = '2026-10-27T09:00:00.000Z'
const TOKEN = 'Bearer owner-access-token'

type Plan = {
  prepare?: () => Promise<{ email: string; code: string; expiresAt: string }>
  setInvited?: () => Promise<void>
  mailer?: Mailer | null
  siteUrl?: string | null
}

function setup(plan: Plan = {}) {
  const calls: string[] = []
  const authorizations: string[] = []
  const sent: Mail[] = []
  const logs: string[] = []
  const database = (authorization: string): Database => {
    authorizations.push(authorization)
    return {
      prepareInvite: (id) => {
        calls.push(`prepare ${id}`)
        return plan.prepare?.() ?? Promise.resolve({ email: EMAIL, code: CODE, expiresAt: EXPIRES })
      },
      setInvited: (id) => {
        calls.push(`invited ${id}`)
        return plan.setInvited?.() ?? Promise.resolve()
      },
    }
  }
  const mailer: Mailer = { send: (mail) => Promise.resolve(void sent.push(mail)) }
  const deps: HandlerDeps = {
    database,
    mailer: plan.mailer === undefined ? mailer : plan.mailer,
    siteUrl: plan.siteUrl === undefined ? 'https://libellus.example.org' : plan.siteUrl,
    log: (line) => logs.push(line),
  }
  return { handler: createHandler(deps), calls, authorizations, sent, logs }
}

const invite = (body: unknown = { id: ID }, headers: Record<string, string> = { authorization: TOKEN }) =>
  new Request('http://localhost/waitlist-invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

Deno.test('an invite is prepared as the caller, mailed, then marked invited', async () => {
  const { handler, calls, authorizations, sent } = setup()
  const response = await handler(invite())

  assertEquals(response.status, 200)
  assertEquals(await response.json(), { code: CODE, expiresAt: EXPIRES, emailed: true })
  assertEquals(authorizations, [TOKEN], 'the database is asked with the caller\'s own session')
  assertEquals(calls, [`prepare ${ID}`, `invited ${ID}`])
  assertEquals(sent.length, 1)
  assertEquals(sent[0].to, EMAIL)
  assertEquals(sent[0].subject, 'Your Libellus invite')
  assertStringIncludes(sent[0].text, CODE)
  assertStringIncludes(sent[0].text, 'https://libellus.example.org/sign-up')
  assertEquals(response.headers.get('access-control-allow-origin'), '*')
})

Deno.test('without SMTP the code comes back, nothing is sent and the entry stays waiting', async () => {
  const { handler, calls, sent } = setup({ mailer: null })
  const response = await handler(invite())

  assertEquals(response.status, 200)
  assertEquals(await response.json(), { code: CODE, expiresAt: EXPIRES, emailed: false, reason: 'not_configured' })
  assertEquals(calls, [`prepare ${ID}`])
  assertEquals(sent, [])
})

Deno.test('a failed send returns the code, marks nothing and logs neither the address nor the code', async () => {
  const refused = Object.assign(new Error(`Can't send mail - all recipients were rejected: 550 <${EMAIL}>: ${CODE}`), {
    code: 'EENVELOPE',
    responseCode: 550,
  })
  const { handler, calls, logs } = setup({ mailer: { send: () => Promise.reject(refused) } })
  const response = await handler(invite())

  assertEquals(response.status, 200)
  assertEquals(await response.json(), { code: CODE, expiresAt: EXPIRES, emailed: false, reason: 'send_failed' })
  assertEquals(calls, [`prepare ${ID}`])
  assertEquals(logs, ['waitlist-invite: sending failed (smtp 550)'])
  for (const line of logs) {
    assertFalse(line.includes(EMAIL), 'a log line carries the address')
    assertFalse(line.includes(CODE), 'a log line carries the code')
  }
})

Deno.test('mailed but not marked: it says so, so the app marks the entry by hand', async () => {
  const { handler, sent } = setup({ setInvited: () => Promise.reject(new DatabaseRefusal('failed')) })
  const response = await handler(invite())

  assertEquals(response.status, 200)
  assertEquals(await response.json(), { code: CODE, expiresAt: EXPIRES, emailed: true, invited: false })
  assertEquals(sent.length, 1)
})

Deno.test('a caller who is not the owner is refused with 403 and nothing is sent', async () => {
  const { handler, calls, sent } = setup({ prepare: () => Promise.reject(new DatabaseRefusal('not_owner')) })
  const response = await handler(invite())

  assertEquals(response.status, 403)
  assertEquals(await response.json(), { error: 'not_owner' })
  assertEquals(calls, [`prepare ${ID}`])
  assertEquals(sent, [])
})

Deno.test('an entry that is gone is a 404', async () => {
  const { handler } = setup({ prepare: () => Promise.reject(new DatabaseRefusal('not_found')) })
  const response = await handler(invite())
  assertEquals(response.status, 404)
  assertEquals(await response.json(), { error: 'not_found' })
})

Deno.test('a database that fails is a 502, logged without what was asked', async () => {
  const { handler, logs } = setup({ prepare: () => Promise.reject(new DatabaseRefusal('failed', 'PGRST000')) })
  const response = await handler(invite())
  assertEquals(response.status, 502)
  assertEquals(await response.json(), { error: 'database_failed' })
  assertEquals(logs.length, 1)
  assertFalse(logs[0].includes(ID))
})

Deno.test('a bad body is refused before anything is asked', async () => {
  for (const body of ['not json', '', 'null', {}, { id: 42 }, { id: 'not-a-uuid' }, [ID]]) {
    const { handler, calls } = setup()
    const response = await handler(invite(body))
    assertEquals(response.status, 400, JSON.stringify(body))
    assertEquals(await response.json(), { error: 'bad_request' })
    assertEquals(calls, [])
  }
})

Deno.test('no session, another method, and the CORS preflight', async () => {
  const { handler, calls } = setup()
  const unsigned = await handler(invite({ id: ID }, {}))
  assertEquals(unsigned.status, 401)
  assertEquals(await unsigned.json(), { error: 'unauthorized' })

  const get = await handler(new Request('http://localhost/waitlist-invite', { headers: { authorization: TOKEN } }))
  assertEquals(get.status, 405)
  await get.body?.cancel()

  const preflight = await handler(new Request('http://localhost/waitlist-invite', { method: 'OPTIONS' }))
  assertEquals(preflight.status, 200)
  assertStringIncludes(preflight.headers.get('access-control-allow-headers') ?? '', 'authorization')
  await preflight.body?.cancel()
  assertEquals(calls, [])
})

Deno.test('a failure is logged by its kind, never by its message', () => {
  assertEquals(failureKind(Object.assign(new Error(`<${EMAIL}> rejected`), { responseCode: 553 })), 'smtp 553')
  assertEquals(failureKind(Object.assign(new Error(`connect to ${EMAIL}`), { code: 'ECONNECTION' })), 'ECONNECTION')
  assertEquals(failureKind(new TypeError(EMAIL)), 'TypeError')
  assertEquals(failureKind(Object.assign(new Error('x'), { code: `${EMAIL}`, name: `${CODE}` })), 'unknown')
  assertEquals(failureKind('a string'), 'unknown')
  assert(true)
})
