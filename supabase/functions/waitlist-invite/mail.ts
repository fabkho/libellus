/**
 * The invite mail (issue #171): what someone on the waitlist gets when the owner taps Invite. Its
 * design is BetterReads' mail shell (wordmark, card, the code cell, light and dark from the tokens),
 * generated from design/emails/invite.mjs into `invite_mail.generated.mjs`: never edit that file or
 * write HTML here; change the design source and run `pnpm emails` in design/ (docs/DEVELOPMENT.md,
 * "Emails"). This module only fills the template's placeholders with the runtime values, HTML-escaped
 * in the HTML part, and drops the sign-up link's block when the instance has no `LIBELLUS_SITE_URL`.
 *
 * No tracking pixel, no remote asset, no unsubscribe link: it is one transactional mail she asked for,
 * and the wording she agreed to (consent text '2026-10') says the address is used "only to send you an
 * invite". The plain-text part says the same.
 */
import { html as HTML_TEMPLATES, text as TEXT_TEMPLATES } from './invite_mail.generated.mjs'

/** One mail as the mailer sends it. */
export type Mail = {
  to: string
  subject: string
  text: string
  html: string
}

/** The languages the mail is written in: the app's own. */
export type MailLocale = 'en' | 'de'

/**
 * The language of the mail: the one the person's page was in when she joined the waitlist
 * (`private.waitlist.locale`, answered by `owner_waitlist_prepare_invite`). German for `de`; anything else, and
 * no value, is English. The request is the owner's, so nothing of hers (her `Accept-Language`) says what the
 * recipient reads.
 */
export function mailLocale(locale: string | null | undefined): MailLocale {
  return locale === 'de' ? 'de' : 'en'
}

export const SUBJECTS: Record<MailLocale, string> = {
  en: 'Your BetterReads invite',
  de: 'Deine Einladung zu BetterReads',
}
/** The English subject, for callers that do not choose a language. */
export const SUBJECT = SUBJECTS.en

const DATE_LOCALES: Record<MailLocale, string> = { en: 'en-GB', de: 'de-DE' }

/** The day a code stops working, in words ("26 October 2026", "26. Oktober 2026"); UTC, so a test reads the same anywhere. */
export function expiryDate(expiresAt: string, locale: MailLocale = 'en'): string {
  return new Intl.DateTimeFormat(DATE_LOCALES[locale], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(expiresAt))
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

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * A generated template with its `{{ .Name }}` placeholders filled from `values` (each passed through
 * `escape`) and each `<!--[block]-->…<!--[/block]-->` kept (markers removed) or dropped whole. Throws
 * when a placeholder is left, so a mail never goes out with `{{ … }}` in it.
 */
export function fillTemplate(
  template: string,
  values: Record<string, string>,
  { blocks = {}, escape = (value: string) => value }: { blocks?: Record<string, boolean>; escape?: (value: string) => string } = {},
): string {
  let out = template
  for (const [name, keep] of Object.entries(blocks)) {
    const open = `<!--[${name}]-->`
    const close = `<!--[/${name}]-->`
    out = keep
      ? out.replaceAll(`${open}\n`, '').replaceAll(`${close}\n`, '').replaceAll(open, '').replaceAll(close, '')
      : out.replace(new RegExp(`${open.replace(/[[\]]/g, '\\$&')}[\\s\\S]*?${close.replace(/[[\]/]/g, '\\$&')}\\n?`, 'g'), '')
  }
  for (const placeholder of out.match(/\{\{[^}]*\}\}/g) ?? []) {
    const name = /^\{\{ \.(\w+) \}\}$/.exec(placeholder)?.[1]
    if (!name || !(name in values)) throw new Error(`invite mail: no value for ${placeholder}`)
  }
  // One pass over the placeholders, so a value that itself reads like one is never filled again.
  return out.replace(/\{\{ \.(\w+) \}\}/g, (_, name: string) => escape(values[name]))
}

export function inviteMail({ to, code, expiresAt, siteUrl, locale }: {
  to: string
  code: string
  expiresAt: string
  siteUrl: string | null
  /** What the entry holds (`private.waitlist.locale`); anything but `de` is English. */
  locale?: string | null
}): Mail {
  const language = mailLocale(locale)
  const link = signUpUrl(siteUrl)
  const values = { Code: code, ExpiresOn: expiryDate(expiresAt, language), SignUpUrl: link ?? '' }
  const blocks = { link: link !== null }
  return {
    to,
    subject: SUBJECTS[language],
    html: fillTemplate(HTML_TEMPLATES[language], values, { blocks, escape: escapeHtml }),
    text: fillTemplate(TEXT_TEMPLATES[language], values, { blocks }),
  }
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
