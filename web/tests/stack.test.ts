import { describe, expect, it } from 'vitest'
import { newClient, readMailedCode, sql, uniqueEmail } from './support/stack'

// The scaffold's proof that the data-layer seam works end to end: the app's own
// client against the local stack, the mail catcher, and the six-digit template
// from supabase/config.toml. The sign-in ticket (#3) puts the invite gate in
// front of this and replaces it with the real sign-up and sign-in suite.
describe('the local stack', () => {
  it('starts every client signed out', async () => {
    const { data } = await newClient().auth.getSession()
    expect(data.session).toBeNull()
  })

  it('mails a six-digit code that signs the client in', async () => {
    const email = uniqueEmail('stack')
    const client = newClient()

    const requested = await client.auth.signInWithOtp({ email })
    expect(requested.error).toBeNull()

    const code = await readMailedCode(email)
    expect(code).toMatch(/^\d{6}$/)

    const verified = await client.auth.verifyOtp({ email, token: code, type: 'email' })
    expect(verified.error).toBeNull()
    const { data } = await client.auth.getUser()
    expect(data.user?.email).toBe(email)
  })

  it('refuses a code that was never sent', async () => {
    const email = uniqueEmail('stack')
    const client = newClient()
    await client.auth.signInWithOtp({ email })
    const code = await readMailedCode(email)
    const wrong = code
      .split('')
      .map((digit) => String((Number(digit) + 1) % 10))
      .join('')

    const verified = await client.auth.verifyOtp({ email, token: wrong, type: 'email' })
    expect(verified.error).not.toBeNull()
    expect((await client.auth.getSession()).data.session).toBeNull()
  })

  it('tags what it creates with this run', async () => {
    const email = uniqueEmail('stack')
    await newClient().auth.signInWithOtp({ email })
    await readMailedCode(email)

    const rows = await sql('select 1 from auth.users where email = $1', [email])
    expect(rows).toHaveLength(1)
    expect(email).toContain(`-${process.env.LIBELLUS_TEST_RUN}-`)
  })
})
