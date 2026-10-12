import { describe, expect, it } from 'vitest'
import { createAuth } from '@/data/auth'
import { createWaitlist } from '@/data/waitlist'
import { createInviteCode, emailCooldown, newClient, readMail, readMailedCode, sql, uniqueEmail, visitorClient } from './support/stack'

/**
 * The language of the mails (German group B of #257), against the real stack and its real template
 * (supabase/templates/magic_link.html, subject in supabase/config.toml). Supabase Auth builds the
 * sign-in code's mail from the account's `user_metadata.locale`: `de` is German, anything else English.
 * What these hold the app to: a sign-up in German makes the first mail German; a member's language is
 * copied to her account when it differs; a code asked for from a signed-out device then comes in the
 * language she last used; and the waitlist keeps the language of the page it was joined from.
 */
describe('the sign-in code mail', () => {
  it('is German for a member who signed up in German, English for one who signed up in English', async () => {
    const german = uniqueEmail('mail-de')
    const english = uniqueEmail('mail-en')
    const plain = uniqueEmail('mail-none')

    expect(await createAuth(newClient()).requestSignUpCode({ email: german, inviteCode: await createInviteCode({ maxUses: 1 }), locale: 'de' })).toEqual({ error: null })
    expect(await createAuth(newClient()).requestSignUpCode({ email: english, inviteCode: await createInviteCode({ maxUses: 1 }), locale: 'en' })).toEqual({ error: null })
    // A build that sends no language (an old cached one) gets the English mail.
    expect(await createAuth(newClient()).requestSignUpCode({ email: plain, inviteCode: await createInviteCode({ maxUses: 1 }) })).toEqual({ error: null })

    const de = await readMail(german)
    expect(de.subject).toBe('Dein Anmeldecode für BetterReads')
    expect(de.html).toContain('<html lang="de"')
    expect(de.text).toContain('Gib diesen Code in der App ein')
    expect(de.text).toMatch(/\b\d{6}\b/)
    expect(de.text).not.toContain('Enter this code')

    for (const email of [english, plain]) {
      const en = await readMail(email)
      expect(en.subject).toBe('Your BetterReads sign-in code')
      expect(en.html).toContain('<html lang="en"')
      expect(en.text).toContain('Enter this code in the app')
      expect(en.text).not.toContain('Gib diesen Code')
    }
  })

  it('follows the language the member last used, from any device', async () => {
    const email = uniqueEmail('mail-follow')
    const client = newClient()
    const auth = createAuth(client)
    await auth.requestSignUpCode({ email, inviteCode: await createInviteCode({ maxUses: 1 }), locale: 'en' })
    expect(await auth.verifyCode(email, await readMailedCode(email))).toEqual({ error: null })

    // Already in step: nothing is asked of the network.
    expect(await auth.saveLocale('en')).toBe('unchanged')
    // She switched to German in the Profile.
    expect(await auth.saveLocale('de')).toBe('saved')
    expect(await auth.saveLocale('de')).toBe('unchanged')

    // A signed-out phone asks for a code: German now.
    await emailCooldown()
    expect(await createAuth(newClient()).requestCode(email)).toEqual({ kind: 'sent' })
    expect((await readMail(email, 2)).subject).toBe('Dein Anmeldecode für BetterReads')

    // And back.
    expect(await auth.saveLocale('en')).toBe('saved')
    await emailCooldown()
    expect(await createAuth(newClient()).requestCode(email)).toEqual({ kind: 'sent' })
    expect((await readMail(email, 3)).subject).toBe('Your BetterReads sign-in code')
    // Two waits of the mail window (emailCooldown) and the mails between them.
  }, 90_000)

  it('does not ask for a language when nobody is signed in, and never throws', async () => {
    expect(await createAuth(newClient()).saveLocale('de')).toBe('failed')
  })
})

describe('the waitlist entry', () => {
  it('keeps de or en from the page it was joined from, and nothing else', async () => {
    const waitlist = createWaitlist(visitorClient())
    const rows = async (address: string) =>
      (await sql<{ locale: string | null }>('select locale from private.waitlist where email::text = $1', [address.toLowerCase()]))[0]?.locale

    const german = uniqueEmail('wl-lang-de')
    const other = uniqueEmail('wl-lang-fr')
    const unsent = uniqueEmail('wl-lang-none')
    expect(await waitlist.join(german, null, '', 'de')).toEqual({ error: null })
    expect(await waitlist.join(other, null, '', 'fr' as never)).toEqual({ error: null })
    expect(await waitlist.join(unsent, null)).toEqual({ error: null })

    expect(await rows(german)).toBe('de')
    expect(await rows(other)).toBeNull()
    expect(await rows(unsent)).toBeNull()
  })
})
