/**
 * The invite mail and the SMTP configuration (issue #171): what she reads, with and without the
 * instance's address, and when the function counts mail as configured.
 *
 *   cd supabase/functions/waitlist-invite && deno task test
 */
import { assertEquals, assertFalse, assertStringIncludes } from '@std/assert'
import { expiryDate, implicitTls, inviteMail, signUpUrl, smtpConfigFromEnv, SUBJECT } from './mail.ts'

const base = { to: 'reader@example.org', code: 'K7QM-X2PA', expiresAt: '2026-10-27T09:00:00Z' }

Deno.test('the mail says why, the code, until when and where to sign up', () => {
  const mail = inviteMail({ ...base, siteUrl: 'https://libellus.example.org/' })
  assertEquals(mail.to, 'reader@example.org')
  assertEquals(mail.subject, SUBJECT)
  for (const part of [mail.text, mail.html]) {
    assertStringIncludes(part, 'You asked for an invite to Libellus on a reading page')
    assertStringIncludes(part, 'K7QM-X2PA')
    assertStringIncludes(part, 'until 27 October 2026')
    assertStringIncludes(part, 'Sign up with a code')
    assertStringIncludes(part, 'only to send you this invite')
  }
  assertStringIncludes(mail.text, 'https://libellus.example.org/sign-up')
  assertStringIncludes(mail.html, '<a href="https://libellus.example.org/sign-up">')
})

Deno.test('without the instance\'s address it says what to tap instead of linking', () => {
  for (const siteUrl of [null, '', 'not a url', 'javascript:alert(1)']) {
    const mail = inviteMail({ ...base, siteUrl })
    assertFalse(mail.text.includes('http'), String(siteUrl))
    assertFalse(mail.html.includes('<a '), String(siteUrl))
    assertStringIncludes(mail.text, 'Open Libellus and choose Sign up with a code')
  }
})

Deno.test('nothing in the HTML loads from elsewhere: no image, no pixel', () => {
  const { html } = inviteMail({ ...base, siteUrl: 'https://libellus.example.org' })
  assertFalse(/<img|<link|url\(|src=/i.test(html))
})

Deno.test('the code and the link are escaped in the HTML', () => {
  const { html } = inviteMail({ ...base, code: '<b>&', siteUrl: 'https://libellus.example.org/a"b' })
  assertStringIncludes(html, '&lt;b&gt;&amp;')
  assertFalse(html.includes('a"b'))
})

Deno.test('the sign-up address and the expiry date', () => {
  assertEquals(signUpUrl('https://libellus.example.org'), 'https://libellus.example.org/sign-up')
  assertEquals(signUpUrl(' https://example.org/books/ '), 'https://example.org/books/sign-up')
  assertEquals(signUpUrl('ftp://example.org'), null)
  assertEquals(signUpUrl(undefined), null)
  assertEquals(expiryDate('2026-10-27T23:30:00Z'), '27 October 2026')
})

Deno.test('mail counts as configured only with every required secret', () => {
  const full: Record<string, string> = {
    SMTP_HOST: 'smtp.example.org',
    SMTP_PORT: '465',
    SMTP_USER: 'libellus',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'invites@example.org',
  }
  assertEquals(smtpConfigFromEnv((name) => full[name]), {
    host: 'smtp.example.org',
    port: 465,
    user: 'libellus',
    pass: 'secret',
    from: 'invites@example.org',
    fromName: null,
  })
  assertEquals(smtpConfigFromEnv((name) => ({ ...full, SMTP_FROM_NAME: 'Libellus' })[name])?.fromName, 'Libellus')
  for (const missing of Object.keys(full)) {
    const env: Record<string, string> = { ...full, [missing]: ' ' }
    assertEquals(smtpConfigFromEnv((name) => env[name]), null, missing)
  }
  for (const port of ['0', 'abc', '70000', '25.5']) {
    assertEquals(smtpConfigFromEnv((name) => ({ ...full, SMTP_PORT: port })[name]), null, port)
  }
  assertEquals([465, 2465, 2587, 587].map(implicitTls), [true, true, false, false])
})
