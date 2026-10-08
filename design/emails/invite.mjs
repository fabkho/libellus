// The waitlist invite: what someone on the waitlist gets when the owner taps Invite (#171). The
// `waitlist-invite` edge function sends it, not Supabase Auth, so the output is a module the function
// imports (`format = 'module'`: the HTML and its plain-text twin as strings), and the variables are
// the function's own placeholders, filled in at send time with HTML escaping
// (supabase/functions/waitlist-invite/mail.ts):
//
//   {{ .Code }}        the one-use invite code, e.g. K7QM-X2PA
//   {{ .ExpiresOn }}   the day it stops working, e.g. 27 October 2026
//   {{ .SignUpUrl }}   <LIBELLUS_SITE_URL>/sign-up
//
// Everything between <!--[link]--> and <!--[/link]--> is the sign-up link: kept when the instance has
// LIBELLUS_SITE_URL, dropped whole without it, so a mail without a site URL has no link at all.
// The subject, `Your Libellus invite`, is the function's (mail.ts).

/** Where the generated module goes, relative to the repo root. */
export const output = 'supabase/functions/waitlist-invite/invite_mail.generated.mjs'
export const format = 'module'

/** The sign-up button is a real link; nothing else in the mail is. */
export const allowLinks = true
export const requires = ['{{ .Code }}', '{{ .ExpiresOn }}', '{{ .SignUpUrl }}', '<!--[link]-->', '<!--[/link]-->']
export const forbids = ['{{ .Token }}', '{{ .ConfirmationURL }}']

/** The optional parts the preview also shows removed. */
export const blocks = ['link']

/** Sample values for `web`'s preview script: what the function fills in. */
export const sample = {
  '{{ .Code }}': 'K7QM-X2PA',
  '{{ .ExpiresOn }}': '27 October 2026',
  '{{ .SignUpUrl }}': 'https://libellus.example.org/sign-up',
}

const WHY = 'You asked for an invite on a Libellus reading page. Here is your code:'
const UNTIL = 'It works once, until {{ .ExpiresOn }}.'
const FOOTER = 'You get this email because you asked for an invite on a reading page. We used your address only to send it.'

export function build(kit) {
  const { eyebrow, paragraph, code, button, space, px, x } = kit
  const gap = (name) => `margin-top:${px(space(name))}`
  return kit.render({
    title: 'Your Libellus invite',
    preheader: 'Your Libellus invite code is {{ .Code }}',
    content: [
      eyebrow('You’re invited'),
      paragraph(WHY, { style: `margin-bottom:${px(space('md'))}` }),
      // Nine characters with a dash: smaller than the sign-in code's six digits, so it stays on one
      // line in a phone's card (390 px wide), and still one run to select.
      code('{{ .Code }}', { size: 30, tracking: 5 }),
      paragraph(UNTIL, { step: 'caption', style: gap('md') }),
      paragraph(`Open Libellus, choose <strong ${x('c-ink', 'font-weight:600')}>Sign up with a code</strong>, and enter your email and this code.`, {
        style: gap('md'),
      }),
      `<!--[link]--><div style="${gap('lg')}">${button('{{ .SignUpUrl }}', 'Sign up')}</div><!--[/link]-->`,
    ].join('\n'),
    footer: FOOTER,
  })
}

/** The plain-text part: the same words, the code on a line of its own, the link as an address. */
export function text() {
  return [
    'You’re invited',
    '',
    WHY,
    '',
    '    {{ .Code }}',
    '',
    UNTIL,
    '',
    'Open Libellus, choose Sign up with a code, and enter your email and this code.',
    '<!--[link]-->',
    'Sign up: {{ .SignUpUrl }}',
    '<!--[/link]-->',
    '--',
    FOOTER,
    '',
  ].join('\n')
}
