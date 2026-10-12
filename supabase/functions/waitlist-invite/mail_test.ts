/**
 * The invite mail and the SMTP configuration (issue #171): the designed template (generated from
 * design/emails/invite.mjs) filled with the runtime values, escaped; what she reads with and without
 * the instance's address, its plain-text part, and when the function counts mail as configured.
 *
 *   cd supabase/functions/waitlist-invite && deno task test
 */
import { assertEquals, assertFalse, assertStringIncludes, assertThrows } from '@std/assert'
import { escapeHtml, expiryDate, fillTemplate, implicitTls, inviteMail, mailLocale, signUpUrl, smtpConfigFromEnv, SUBJECT, SUBJECTS } from './mail.ts'

const base = { to: 'reader@example.org', code: 'K7QM-X2PA', expiresAt: '2026-10-27T09:00:00Z' }

Deno.test('the mail says why, the code, until when, how, and links to sign up', () => {
  const mail = inviteMail({ ...base, siteUrl: 'https://libellus.example.org/' })
  assertEquals(mail.to, 'reader@example.org')
  assertEquals(mail.subject, SUBJECT)
  for (const part of [mail.text, mail.html]) {
    assertStringIncludes(part, 'You asked for an invite to BetterReads')
    assertStringIncludes(part, 'K7QM-X2PA')
    assertStringIncludes(part, 'until 27 October 2026')
    assertStringIncludes(part, 'Sign up')
    assertStringIncludes(part, 'We used your address only to send it')
    assertFalse(part.includes('{{'), 'a placeholder is left')
    assertFalse(part.includes('link]-->'), 'a block marker is left')
  }
  // The designed mail: the shell's wordmark, the code in its cell as one run, the button to sign up.
  assertStringIncludes(mail.html, '>betterreads</p>')
  assertStringIncludes(mail.html, 'user-select:all')
  assertStringIncludes(mail.html, '>K7QM-X2PA</div>')
  assertStringIncludes(mail.html, '<a href="https://libellus.example.org/sign-up"')
  assertStringIncludes(mail.html, '@media (prefers-color-scheme:dark)')
  assertStringIncludes(mail.text, 'Sign up: https://libellus.example.org/sign-up')
})

Deno.test('without the instance\'s address the mail has no link at all', () => {
  for (const siteUrl of [null, '', 'not a url', 'javascript:alert(1)']) {
    const mail = inviteMail({ ...base, siteUrl })
    assertFalse(mail.html.includes('<a '), String(siteUrl))
    assertFalse(mail.html.includes('href'), String(siteUrl))
    assertFalse(mail.html.includes('>Sign up</a>'), String(siteUrl))
    assertFalse(mail.text.includes('http'), String(siteUrl))
    assertFalse(mail.text.includes('Sign up:'), String(siteUrl))
    assertFalse(mail.html.includes('link]-->'), String(siteUrl))
    // How to use it is still there.
    assertStringIncludes(mail.text, 'Open BetterReads, choose Sign up,')
    assertStringIncludes(mail.html, 'choose <strong')
  }
})

Deno.test('nothing in the HTML loads from elsewhere: no image, no pixel, no font', () => {
  const { html } = inviteMail({ ...base, siteUrl: 'https://libellus.example.org' })
  assertFalse(/<img|<link\b|<script|url\(|@import|\bsrc=/i.test(html))
})

Deno.test('the values are escaped in the HTML and plain in the text', () => {
  const { html, text } = inviteMail({ ...base, code: '<b>&"x\'' , siteUrl: 'https://libellus.example.org' })
  assertStringIncludes(html, '&lt;b&gt;&amp;&quot;x&#39;')
  assertFalse(html.includes('<b>&'))
  assertStringIncludes(text, '<b>&"x\'')

  const filled = fillTemplate('<a href="{{ .Url }}">{{ .Name }}</a>', { Url: '"><script>x</script>', Name: '{{ .Url }}' }, { escape: escapeHtml })
  assertEquals(filled, '<a href="&quot;&gt;&lt;script&gt;x&lt;/script&gt;">{{ .Url }}</a>', 'a value is filled once and never read as a placeholder')
})

Deno.test('a template is filled whole or not at all', () => {
  assertThrows(() => fillTemplate('{{ .Code }} {{ .Other }}', { Code: 'x' }), Error, '{{ .Other }}')
  assertThrows(() => fillTemplate('{{ .Token }}', {}), Error)
  assertEquals(fillTemplate('a<!--[b]-->B<!--[/b]-->c', {}, { blocks: { b: true } }), 'aBc')
  assertEquals(fillTemplate('a<!--[b]-->B<!--[/b]-->c', {}, { blocks: { b: false } }), 'ac')
  assertEquals(fillTemplate('a\n<!--[b]-->\nB\n<!--[/b]-->\nc', {}, { blocks: { b: false } }), 'a\nc')
})

Deno.test('the plain-text part says what the HTML says, line by line', () => {
  const { text } = inviteMail({ ...base, siteUrl: 'https://libellus.example.org' })
  assertEquals(text.split('\n'), [
    'You’re invited',
    '',
    'You asked for an invite to BetterReads. Here is your code:',
    '',
    '    K7QM-X2PA',
    '',
    'It works once, until 27 October 2026.',
    '',
    'Open BetterReads, choose Sign up, and enter your email and this code.',
    'Sign up: https://libellus.example.org/sign-up',
    '--',
    'You get this email because you asked for an invite on a reading page. We used your address only to send it.',
    '',
  ])
})

Deno.test('the sign-up address and the expiry date', () => {
  assertEquals(signUpUrl('https://libellus.example.org'), 'https://libellus.example.org/sign-up')
  assertEquals(signUpUrl(' https://example.org/books/ '), 'https://example.org/books/sign-up')
  assertEquals(signUpUrl('ftp://example.org'), null)
  assertEquals(signUpUrl(undefined), null)
  assertEquals(expiryDate('2026-10-27T23:30:00Z'), '27 October 2026')
  assertEquals(expiryDate('2026-10-27T23:30:00Z', 'de'), '27. Oktober 2026')
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
  assertEquals(smtpConfigFromEnv((name) => ({ ...full, SMTP_FROM_NAME: 'BetterReads' })[name])?.fromName, 'BetterReads')
  for (const missing of Object.keys(full)) {
    const env: Record<string, string> = { ...full, [missing]: ' ' }
    assertEquals(smtpConfigFromEnv((name) => env[name]), null, missing)
  }
  for (const port of ['0', 'abc', '70000', '25.5']) {
    assertEquals(smtpConfigFromEnv((name) => ({ ...full, SMTP_PORT: port })[name]), null, port)
  }
  assertEquals([465, 2465, 2587, 587].map(implicitTls), [true, true, false, false])
})

// ------------------------------------------------------------------ the language (German group B of #257)

Deno.test('the language is German for de and English for everything else', () => {
  assertEquals(['de', 'en', 'fr', '', null, undefined, 'DE', 'de-AT'].map(mailLocale), ['de', 'en', 'en', 'en', 'en', 'en', 'en', 'en'])
})

Deno.test('a mail for a German entry is German, from subject to date, with the same code and link', () => {
  const mail = inviteMail({ ...base, siteUrl: 'https://libellus.example.org/', locale: 'de' })
  assertEquals(mail.subject, 'Deine Einladung zu BetterReads')
  assertEquals(mail.subject, SUBJECTS.de)
  for (const part of [mail.text, mail.html]) {
    assertStringIncludes(part, 'Du hast um eine Einladung zu BetterReads gebeten')
    assertStringIncludes(part, 'K7QM-X2PA')
    assertStringIncludes(part, 'bis zum 27. Oktober 2026')
    assertStringIncludes(part, 'Registrieren')
    assertStringIncludes(part, 'Wir haben deine Adresse nur dafür verwendet')
    assertFalse(part.includes('You asked'), 'English is left in the German mail')
    assertFalse(part.includes('{{'), 'a placeholder is left')
    assertFalse(part.includes('link]-->'), 'a block marker is left')
  }
  assertStringIncludes(mail.html, '<html lang="de"')
  assertFalse(mail.html.includes('aller Ruhe'), 'no tagline under the wordmark')
  assertStringIncludes(mail.html, '<a href="https://libellus.example.org/sign-up"')
  assertStringIncludes(mail.text, 'Registrieren: https://libellus.example.org/sign-up')
})

Deno.test('the German mail without a site address has no link either', () => {
  const mail = inviteMail({ ...base, siteUrl: null, locale: 'de' })
  assertFalse(mail.html.includes('<a '))
  assertFalse(mail.text.includes('http'))
  assertStringIncludes(mail.text, 'Öffne BetterReads, wähle Registrieren und gib deine E-Mail-Adresse und diesen Code ein.')
})

Deno.test('an entry with no language, or one the app does not speak, gets the English mail', () => {
  for (const locale of [undefined, null, 'en', 'fr', '']) {
    const mail = inviteMail({ ...base, siteUrl: null, locale })
    assertEquals(mail.subject, SUBJECT, String(locale))
    assertStringIncludes(mail.html, '<html lang="en"')
    assertStringIncludes(mail.text, 'You asked for an invite')
  }
})
