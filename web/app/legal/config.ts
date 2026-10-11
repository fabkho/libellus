/**
 * The full imprint (Impressum) is postponed (docs/legal-checklist.md, "The imprint is postponed"): the owner
 * decided the friends round ships with the privacy notice only. While this is `false`, `/imprint` is an
 * address that does not exist (the sign-in guard does not list it, and the page's `validate` fails: the same
 * 404 as any unknown address), nothing links to it, and the privacy notice names its controller by name and
 * e-mail address only. The imprint's text stays in `imprint.ts` and the postal address and second contact stay
 * in `privacy.ts` behind this constant: turning it on is this one switch (and the placeholders it brings back,
 * see the checklist).
 */
export const IMPRINT_ENABLED = false
