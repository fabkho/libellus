import { beforeAll, describe, expect, it } from 'vitest'
import { createAuth } from '@/data/auth'
import { signUpMember, type TestMember } from './support/member'
import {
  accountExists,
  authUserExists,
  emailCooldown,
  mistype,
  newClient,
  readMailedCode,
  uniqueEmail,
} from './support/stack'

/**
 * Signing in is the same six-digit code as signing up. The rule worth holding
 * onto is that it must never quietly create an account: the invite code is the
 * only door in. The sign-in screen asks for the address alone, so this call is
 * also what decides whether a member is signing in or about to sign up.
 */
describe('signing in with a mailed code', () => {
  let member: TestMember

  beforeAll(async () => {
    member = await signUpMember()
  })

  it('sends an address with no account on to sign-up instead of failing', async () => {
    const email = uniqueEmail('stranger')
    const auth = createAuth(newClient())

    expect(await auth.requestCode(email)).toEqual({ kind: 'unknownEmail' })
    expect(await authUserExists(email)).toBe(false)
    expect(await accountExists(email)).toBe(false)
  })

  it('signs an existing member in on a phone that has never seen them', async () => {
    const client = newClient()
    const auth = createAuth(client)

    await emailCooldown()
    expect(await auth.requestCode(member.email)).toEqual({ kind: 'sent' })
    // The first mail was the sign-up code, this is the second.
    expect(await auth.verifyCode(member.email, await readMailedCode(member.email, 2))).toEqual({
      error: null,
    })

    expect(await auth.currentMember()).toEqual({ id: member.id, email: member.email })
  })

  it('refuses a mistyped code and leaves the phone signed out', async () => {
    const client = newClient()
    const auth = createAuth(client)

    await emailCooldown()
    await auth.requestCode(member.email)
    const mailed = await readMailedCode(member.email, 3)

    expect(await auth.verifyCode(member.email, mistype(mailed))).toEqual({ error: 'code_invalid' })
    expect(await auth.currentMember()).toBeNull()
  })

  it('refuses a code that has already been used', async () => {
    const auth = createAuth(newClient())

    await emailCooldown()
    await auth.requestCode(member.email)
    const mailed = await readMailedCode(member.email, 4)
    expect(await auth.verifyCode(member.email, mailed)).toEqual({ error: null })

    const other = createAuth(newClient())
    expect(await other.verifyCode(member.email, mailed)).toEqual({ error: 'code_invalid' })
    expect(await other.currentMember()).toBeNull()
  })

  it('asks a member who taps resend twice to wait', async () => {
    const auth = createAuth(newClient())

    await emailCooldown()
    expect(await auth.requestCode(member.email)).toEqual({ kind: 'sent' })

    // The verify screen's resend button, tapped again straight away.
    expect(await auth.requestCode(member.email)).toEqual({ kind: 'error', code: 'rate_limited' })
  })
})
