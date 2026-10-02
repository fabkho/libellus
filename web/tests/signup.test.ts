import { describe, expect, it } from 'vitest'
import { createAuth } from '@/data/auth'
import {
  accountExists,
  authUserExists,
  createInviteCode,
  inviteCodeUses,
  mailCount,
  newClient,
  readMailedCode,
  uniqueEmail,
} from './support/stack'

/**
 * Signing up is the only way in, and the invite code is the only door
 * (SPEC.md, Access). These run the real thing: the app's repository against
 * GoTrue, the signup trigger and the local mail catcher.
 */
describe('signing up with an invite code', () => {
  it('lets an address in with a live code, and spends the invite when the address is proved', async () => {
    const code = await createInviteCode({ maxUses: 2 })
    const email = uniqueEmail('signup')
    const client = newClient()
    const auth = createAuth(client)

    expect(await auth.requestSignUpCode({ email, inviteCode: code })).toEqual({ error: null })

    // The auth user exists (GoTrue makes it to mail the code, and that is what
    // lets resend work), but nothing is spent on an address nobody has proved.
    expect(await authUserExists(email)).toBe(true)
    expect(await accountExists(email)).toBe(false)
    expect(await inviteCodeUses(code)).toBe(0)

    expect(await auth.verifyCode(email, await readMailedCode(email))).toEqual({ error: null })

    expect(await accountExists(email)).toBe(true)
    expect(await inviteCodeUses(code)).toBe(1)
    expect(await auth.currentMember()).toMatchObject({ email })
  })

  it('takes the code in any case, as it was typed on a phone', async () => {
    const code = await createInviteCode({ maxUses: 1 })
    const auth = createAuth(newClient())

    expect(
      await auth.requestSignUpCode({ email: uniqueEmail('case'), inviteCode: `  ${code.toLowerCase()} ` }),
    ).toEqual({ error: null })
  })

  it('refuses a signup with no code at all, without mailing or creating anything', async () => {
    const email = uniqueEmail('missing-code')
    const auth = createAuth(newClient())

    expect(await auth.requestSignUpCode({ email, inviteCode: '   ' })).toEqual({
      error: 'invite_required',
    })
    expect(await authUserExists(email)).toBe(false)
    expect(await mailCount(email)).toBe(0)
  })

  it('refuses a code nobody handed out', async () => {
    const email = uniqueEmail('unknown-code')
    const auth = createAuth(newClient())

    expect(await auth.requestSignUpCode({ email, inviteCode: 'NO-SUCH-CODE' })).toEqual({
      error: 'invite_invalid',
    })
    expect(await authUserExists(email)).toBe(false)
    expect(await mailCount(email)).toBe(0)
  })

  it('refuses an expired code and leaves nothing behind', async () => {
    const code = await createInviteCode({ expiresAt: new Date(Date.now() - 60_000) })
    const email = uniqueEmail('expired-code')
    const auth = createAuth(newClient())

    expect(await auth.requestSignUpCode({ email, inviteCode: code })).toEqual({
      error: 'invite_expired',
    })
    expect(await authUserExists(email)).toBe(false)
    expect(await mailCount(email)).toBe(0)
  })

  it('refuses a code that has been used up, and does not raise its count', async () => {
    const code = await createInviteCode({ maxUses: 1, uses: 1 })
    const email = uniqueEmail('exhausted-code')
    const auth = createAuth(newClient())

    expect(await auth.requestSignUpCode({ email, inviteCode: code })).toEqual({
      error: 'invite_exhausted',
    })
    expect(await authUserExists(email)).toBe(false)
    expect(await inviteCodeUses(code)).toBe(1)
  })

  it('refuses the second of two pending signups once the last slot is gone', async () => {
    const code = await createInviteCode({ maxUses: 1 })
    const firstEmail = uniqueEmail('race-first')
    const secondEmail = uniqueEmail('race-second')
    const first = createAuth(newClient())
    const secondClient = newClient()
    const second = createAuth(secondClient)

    // Both get a code: the one use is not spoken for until somebody proves an
    // address, so the form cannot tell them apart yet.
    expect(await first.requestSignUpCode({ email: firstEmail, inviteCode: code })).toEqual({
      error: null,
    })
    expect(await second.requestSignUpCode({ email: secondEmail, inviteCode: code })).toEqual({
      error: null,
    })
    expect(await inviteCodeUses(code)).toBe(0)
    const secondCode = await readMailedCode(secondEmail)

    expect(await first.verifyCode(firstEmail, await readMailedCode(firstEmail))).toEqual({
      error: null,
    })
    expect(await inviteCodeUses(code)).toBe(1)

    // The refusal comes from the database, through GoTrue, as a code the screen
    // can explain rather than as "something went wrong".
    expect(await second.verifyCode(secondEmail, secondCode)).toEqual({ error: 'invite_gone' })
    expect(await second.currentMember()).toBeNull()
    expect(await accountExists(secondEmail)).toBe(false)
    expect(await inviteCodeUses(code)).toBe(1)
  })

  it('does not let a member in twice on one invite', async () => {
    const code = await createInviteCode({ maxUses: 1 })
    const email = uniqueEmail('twice')
    const auth = createAuth(newClient())

    await auth.requestSignUpCode({ email, inviteCode: code })
    await auth.verifyCode(email, await readMailedCode(email))
    expect(await inviteCodeUses(code)).toBe(1)

    // Signing in again later is another verification of the same address.
    const again = createAuth(newClient())
    await again.requestCode(email)
    await again.verifyCode(email, await readMailedCode(email, 2))
    expect(await inviteCodeUses(code)).toBe(1)
  })
})
