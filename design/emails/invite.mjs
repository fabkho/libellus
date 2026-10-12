// The waitlist invite: what someone on the waitlist gets when the owner taps Invite (#171). The
// `waitlist-invite` edge function sends it, not Supabase Auth, so the output is a module the function
// imports (`format = 'module'`: the HTML and its plain-text twin as strings), and the variables are
// the function's own placeholders, filled in at send time with HTML escaping
// (supabase/functions/waitlist-invite/mail.ts):
//
//   {{ .Code }}        the one-use invite code, e.g. K7QM-X2PA
//   {{ .ExpiresOn }}   the day it stops working, in the mail's language: 27 October 2026 / 27. Oktober 2026
//   {{ .SignUpUrl }}   <LIBELLUS_SITE_URL>/sign-up
//
// Everything between <!--[link]--> and <!--[/link]--> is the sign-up link: kept when the instance has
// LIBELLUS_SITE_URL, dropped whole without it, so a mail without a site URL has no link at all.
// Two languages, `en` and `de`: the module exports `html` and `text` as `{ en, de }`, and the function picks by the
// language the person had when she joined the waitlist (`private.waitlist.locale`, mail.ts). The subjects are the
// function's too (mail.ts).

/** Where the generated module goes, relative to the repo root. */
export const output = 'supabase/functions/waitlist-invite/invite_mail.generated.mjs'
export const format = 'module'
export const languages = ['en', 'de']

/** The sign-up button is a real link; nothing else in the mail is. */
export const allowLinks = true
export const requires = ['{{ .Code }}', '{{ .ExpiresOn }}', '{{ .SignUpUrl }}', '<!--[link]-->', '<!--[/link]-->']
export const forbids = ['{{ .Token }}', '{{ .ConfirmationURL }}']

/** The optional parts the preview also shows removed. */
export const blocks = ['link']

/** Sample values for `web`'s preview script: what the function fills in, per language. */
export const sample = {
  en: {
    '{{ .Code }}': 'K7QM-X2PA',
    '{{ .ExpiresOn }}': '27 October 2026',
    '{{ .SignUpUrl }}': 'https://libellus.example.org/sign-up',
  },
  de: {
    '{{ .Code }}': 'K7QM-X2PA',
    '{{ .ExpiresOn }}': '27. Oktober 2026',
    '{{ .SignUpUrl }}': 'https://libellus.example.org/sign-up',
  },
}

// What the sign-in screen calls the way in (web/i18n/locales: signIn.signUpLink).
const COPY = {
  en: {
    title: 'Your BetterReads invite',
    preheader: 'Your BetterReads invite code is {{ .Code }}',
    eyebrow: 'You’re invited',
    why: 'You asked for an invite to BetterReads. Here is your code:',
    until: 'It works once, until {{ .ExpiresOn }}.',
    signUp: 'Sign up',
    open: (strong) => `Open BetterReads, choose ${strong('Sign up')}, and enter your email and this code.`,
    openText: 'Open BetterReads, choose Sign up, and enter your email and this code.',
    footer: 'You get this email because you asked for an invite on a reading page. We used your address only to send it.',
  },
  de: {
    title: 'Deine Einladung zu BetterReads',
    preheader: 'Dein Einladungscode für BetterReads lautet {{ .Code }}',
    eyebrow: 'Du bist eingeladen',
    why: 'Du hast um eine Einladung zu BetterReads gebeten. Hier ist dein Code:',
    until: 'Er gilt einmal, bis zum {{ .ExpiresOn }}.',
    signUp: 'Registrieren',
    open: (strong) => `Öffne BetterReads, wähle ${strong('Registrieren')} und gib deine E-Mail-Adresse und diesen Code ein.`,
    openText: 'Öffne BetterReads, wähle Registrieren und gib deine E-Mail-Adresse und diesen Code ein.',
    footer: 'Du bekommst diese E-Mail, weil du auf einer Leseseite um eine Einladung gebeten hast. Wir haben deine Adresse nur dafür verwendet.',
  },
}

export function build(kit, lang = 'en') {
  const { eyebrow, paragraph, code, button, space, px, x } = kit
  const copy = COPY[lang]
  const gap = (name) => `margin-top:${px(space(name))}`
  const strong = (label) => `<strong ${x('c-ink', 'font-weight:600')}>${label}</strong>`
  return kit.render({
    lang,
    title: copy.title,
    preheader: copy.preheader,
    content: [
      eyebrow(copy.eyebrow),
      paragraph(copy.why, { style: `margin-bottom:${px(space('md'))}` }),
      // Nine characters with a dash: smaller than the sign-in code's six digits, so it stays on one
      // line in a phone's card (390 px wide), and still one run to select.
      code('{{ .Code }}', { size: 30, tracking: 5 }),
      paragraph(copy.until, { step: 'caption', style: gap('md') }),
      paragraph(copy.open(strong), { style: gap('md') }),
      `<!--[link]--><div style="${gap('lg')}">${button('{{ .SignUpUrl }}', copy.signUp)}</div><!--[/link]-->`,
    ].join('\n'),
    footer: copy.footer,
  })
}

/** The plain-text part: the same words, the code on a line of its own, the link as an address. */
export function text(lang = 'en') {
  const copy = COPY[lang]
  return [
    copy.eyebrow,
    '',
    copy.why,
    '',
    '    {{ .Code }}',
    '',
    copy.until,
    '',
    copy.openText,
    '<!--[link]-->',
    `${copy.signUp}: {{ .SignUpUrl }}`,
    '<!--[/link]-->',
    '--',
    copy.footer,
    '',
  ].join('\n')
}
