// The sign-in code: Supabase's "Magic Link" and "Confirm signup" templates, one body for both
// (docs/SELF_HOSTING.md, step 1.3). The member types the six digits into the app; there is no link,
// so there is no {{ .ConfirmationURL }} and no button. The subject, `Your Libellus sign-in code`,
// lives in config.toml and the dashboard, not here.

/** Where the generated file goes, relative to the repo root. */
export const output = 'supabase/templates/magic_link.html'

/** Supabase fills `{{ .Token }}`; the app never uses links, so none may sneak in. */
export const requires = ['{{ .Token }}']
export const forbids = ['{{ .ConfirmationURL }}', '<a ']

/** Sample values for `web`'s preview script: what Supabase would fill in for each variable. */
export const sample = { '{{ .Token }}': '482913' }

export function build(kit) {
  const { eyebrow, paragraph, code, space, px } = kit
  const below = `margin-top:${px(space('md'))}`
  return kit.render({
    title: 'Your Libellus sign-in code',
    preheader: 'Your Libellus code is {{ .Token }}',
    content: [
      eyebrow('Your sign-in code'),
      paragraph('Enter this code in the app:', { style: `margin-bottom:${px(space('md'))}` }),
      code('{{ .Token }}'),
      paragraph('The code is valid for one hour and can be used once.', { step: 'caption', style: below }),
    ].join('\n'),
    footer: "If this wasn't you, you can ignore this email.",
  })
}
