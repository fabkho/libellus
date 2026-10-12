// The sign-in code: Supabase's "Magic Link" and "Confirm signup" templates, one body for both
// (docs/SETUP.md, step 1.3). The member types the six digits into the app; there is no link,
// so there is no {{ .ConfirmationURL }} and no button.
//
// Two languages in one file, because Supabase has one template per kind of mail and no per-request
// language. Auth fills `{{ .Data }}` with the account's `user_metadata`, so the template branches on
// `{{ index .Data "locale" }}`: `de` is the German mail, anything else (a missing key, `en`, a language
// the app does not speak) the English one. The app writes that key (`locale`) when a member signs up
// and whenever the language it shows differs from what the account holds (docs/i18n/README.md, "Mails").
// The subject cannot live in the file: it is in config.toml and the dashboard, with the same branch.

/** Where the generated file goes, relative to the repo root. */
export const output = 'supabase/templates/magic_link.html'

/** English first: it is the fallback of the Go template's `else`. */
export const languages = ['en', 'de']

/** The one condition the combined file uses; the subject in config.toml uses the same. */
export const condition = { de: '{{ if eq (index .Data "locale") "de" }}' }

/** Supabase fills `{{ .Token }}`; the app never uses links, so none may sneak in. */
export const requires = ['{{ .Token }}']
export const forbids = ['{{ .ConfirmationURL }}', '<a ']

/** Sample values for `web`'s preview script: what Supabase would fill in for each variable. */
export const sample = { '{{ .Token }}': '482913' }

const COPY = {
  en: {
    title: 'Your BetterReads sign-in code',
    preheader: 'Your BetterReads code is {{ .Token }}',
    eyebrow: 'Your sign-in code',
    enter: 'Enter this code in the app:',
    valid: 'The code is valid for one hour and can be used once.',
    footer: "If this wasn't you, you can ignore this email.",
  },
  de: {
    title: 'Dein BetterReads-Anmeldecode',
    preheader: 'Dein BetterReads-Code lautet {{ .Token }}',
    eyebrow: 'Dein Anmeldecode',
    enter: 'Gib diesen Code in der App ein:',
    valid: 'Der Code gilt eine Stunde und kann einmal verwendet werden.',
    footer: 'Wenn du das nicht warst, kannst du diese E-Mail ignorieren.',
  },
}

export function build(kit, lang = 'en') {
  const { eyebrow, paragraph, code, space, px } = kit
  const copy = COPY[lang]
  const below = `margin-top:${px(space('md'))}`
  return kit.render({
    lang,
    title: copy.title,
    preheader: copy.preheader,
    content: [
      eyebrow(copy.eyebrow),
      paragraph(copy.enter, { style: `margin-bottom:${px(space('md'))}` }),
      code('{{ .Token }}'),
      paragraph(copy.valid, { step: 'caption', style: below }),
    ].join('\n'),
    footer: copy.footer,
  })
}
