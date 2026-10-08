/**
 * The invite mail (issue #171): what someone on the waitlist gets when the owner taps Invite. Short,
 * English, plain text with a minimal HTML twin: why she gets it (she asked for an invite on a reading
 * page), the code, until when it works and how to use it. No tracking pixel, no remote image, no
 * unsubscribe link: it is one transactional mail she asked for, and the wording she agreed to
 * (consent text '2026-10') says the address is used "only to send you an invite".
 */

/** One mail as the mailer sends it. */
export type Mail = {
  to: string
  subject: string
  text: string
  html: string
}

export const SUBJECT = 'Your Libellus invite'

/** The day a code stops working, in words ("26 October 2026"); UTC, so a test reads the same anywhere. */
export function expiryDate(expiresAt: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(expiresAt))
}

/**
 * The address of the sign-up screen on the instance (`LIBELLUS_SITE_URL` + /sign-up), or null when
 * the secret is unset or not an http(s) address: the mail then says what to tap instead of linking.
 */
export function signUpUrl(siteUrl: string | null | undefined): string | null {
  const site = siteUrl?.trim()
  if (!site) return null
  try {
    const url = new URL(site)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}/sign-up`
  } catch {
    return null
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function inviteMail({ to, code, expiresAt, siteUrl }: { to: string; code: string; expiresAt: string; siteUrl: string | null }): Mail {
  const until = expiryDate(expiresAt)
  const link = signUpUrl(siteUrl)

  const how = link
    ? `Sign up with a code at ${link}, using this email address and the code.`
    : 'Open Libellus and choose Sign up with a code ("Have an invite code? Sign up"), then enter this email address and the code.'

  const text = [
    'Hello,',
    '',
    'You asked for an invite to Libellus on a reading page. Here it is.',
    '',
    `Your invite code: ${code}`,
    `It works once, until ${until}.`,
    '',
    how,
    '',
    'We used your address only to send you this invite.',
    '',
    'Libellus',
    '',
  ].join('\n')

  const htmlHow = link
    ? `<a href="${escapeHtml(link)}">Sign up with a code</a>, using this email address and the code.`
    : 'Open Libellus and choose <strong>Sign up with a code</strong> (“Have an invite code? Sign up”), then enter this email address and the code.'

  const html = [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="utf-8"><title>Your Libellus invite</title></head>',
    '<body style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.5;">',
    '<p>Hello,</p>',
    '<p>You asked for an invite to Libellus on a reading page. Here it is.</p>',
    `<p>Your invite code:<br><strong style="font-family: ui-monospace, Menlo, monospace; font-size: 1.25em; letter-spacing: 0.05em;">${escapeHtml(code)}</strong></p>`,
    `<p>It works once, until ${escapeHtml(until)}.</p>`,
    `<p>${htmlHow}</p>`,
    '<p>We used your address only to send you this invite.</p>',
    '<p>Libellus</p>',
    '</body></html>',
    '',
  ].join('\n')

  return { to, subject: SUBJECT, text, html }
}

// ------------------------------------------------------------------ sending

/** Whatever sends one mail; throws when it was not accepted. */
export type Mailer = { send: (mail: Mail) => Promise<void> }

export type SmtpConfig = {
  host: string
  port: number
  user: string
  pass: string
  from: string
  fromName: string | null
}

/** The configuration from the secrets, or null when one of the required ones is missing (mail not configured). */
export function smtpConfigFromEnv(get: (name: string) => string | undefined): SmtpConfig | null {
  const value = (name: string) => get(name)?.trim() || null
  const host = value('SMTP_HOST')
  const port = Number(value('SMTP_PORT'))
  const user = value('SMTP_USER')
  // A password is taken as it is (blanks may belong to it), but one of blanks only is none.
  const pass = get('SMTP_PASS')?.trim() ? get('SMTP_PASS')! : null
  const from = value('SMTP_FROM')
  if (!host || !user || !pass || !from || !Number.isInteger(port) || port <= 0 || port > 65535) return null
  return { host, port, user, pass, from, fromName: value('SMTP_FROM_NAME') }
}

/** Whether a port speaks TLS from the first byte (SMTPS) rather than upgrading with STARTTLS. */
export const implicitTls = (port: number) => port === 465 || port === 2465
