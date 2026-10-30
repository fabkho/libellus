# Legal pages: checklist for the owner

The privacy notice (`/privacy`) is a **draft**: written against what the app does, **not legal advice**, and not
reviewed by a lawyer. The full imprint (`/imprint`) is **postponed** (below): the friends round ships with the privacy
notice only. Both pages carry English and German text on the same page (`web/app/legal/`), because the app's own German
catalogue does not exist yet (issue #257). While a placeholder is left in the text, the page shows a "Draft" note; it
goes away by itself when the last one is filled.

## Placeholders

**None are left** on the pages that are on. `web/tests/legal.test.ts` fails when the texts of those pages hold a
`[[…]]` placeholder that is not listed in a table here, so a new one cannot slip in unlisted; while one is left the
page shows a "Draft" note, which goes away by itself when the last one is filled. The values live in
`web/app/legal/placeholders.ts` (the e-mail address) and in `web/app/legal/privacy.ts` (the supervisory authority, the
mail provider's lines). The imprint's two placeholders, not shown while it is postponed, are in the next section.

**A postal address is customary** and recommended before a wider launch. Art. 13 GDPR asks the notice for the
controller's identity and contact details, which the name and the e-mail address give; most notices add the postal
address too. It comes back with the imprint (below), or earlier by hand: add `X.address` to the "Who is responsible"
lines in `privacy.ts` (and list it in a table here).

## Owner checks before the friends round

- **The alias must receive mail.** The notice names `privacy@fabkho.dev` (a Cloudflare Email Routing alias) as the contact
  and for rights requests: send it a test mail and see that it arrives.
- **Resend's sending region.** The notice says Ireland (EU): confirm in the Resend dashboard under Domains that the
  sending region is Ireland.
- **A lawyer's glance** before a wider launch.

## The imprint is postponed: what turning it on needs

The owner decided to leave the full imprint (Impressum, § 5 DDG) out of the friends round. Its text stays in
`web/app/legal/imprint.ts` and the postal address stays in `privacy.ts`, both inactive behind one constant,
`IMPRINT_ENABLED` in `web/app/legal/config.ts` (`false`). While it is `false`, `/imprint` is an address that does not
exist (a 404 for a signed-in member, the sign-in for anyone else), nothing links to it (the sign-in, sign-up and verify
screens and the Profile show "Privacy" alone), and the privacy notice names its controller by name and e-mail only.

To turn it on:

1. Fill the two placeholders it brings back: `[[STREET, POSTCODE, CITY]]` (your postal address; a P.O. box does not
   satisfy § 5 DDG) and `[[PHONE OR CONTACT FORM]]` (a second, fast way to reach you: a phone number, or a contact form
   if you build one). Write the real values in `web/app/legal/placeholders.ts`, or keep the markers and list each in a
   table row here (the first cell the marker in backticks); `web/tests/legal.test.ts` wants one or the other.
2. Set `IMPRINT_ENABLED = true`. The route, the "Privacy · Imprint" lines, the cross-reference in the privacy notice and
   the postal address in "Who is responsible" all come back with it.
3. Have the imprint read by a lawyer: whether anything more is needed (a content-responsible person under § 18 MStV, a
   consumer-arbitration notice) is theirs to say; the text claims neither.

The supervisory-authority line stays with the privacy notice either way.

## Things to check against reality

The notice says these; confirm each, or change the text (and the version date) when it is not so.

- **Supabase** project region is `eu-central-1` (dashboard → Project settings), and the provider is named correctly
  (Supabase Pte. Ltd., Singapore) with its data processing agreement accepted.
- **Cloudflare**: Web Analytics stays cookieless and stores nothing on the device (docs/HOSTING.md); the data processing
  terms are accepted; the R2 bucket `libellus-backups` has its location hint `weur` and the 35-day rule; and, once the
  stored covers are on, the bucket `libellus-covers` is private (no public access, no `r2.dev` address, no custom domain),
  location hint `weur`, with **no lifecycle rule** (the 30-day grace is the cover job's own, docs/OPERATIONS.md) and not in
  the backup.
- **The stored covers** (*Own covers* in docs/THIRD-PARTY.md): the notice says my server fetches the covers of books in
  members' Libraries once and keeps them in a private storage space, that no name in there can be traced to a cover or a
  member, and that a cover goes 30 days after no Library holds its book. Confirm against
  `select public.owner_cover_status();` and the take-down steps (docs/OPERATIONS.md, "Own covers") when the feature is
  turned on.
- **Resend**: the data processing agreement is accepted, and the notice's lines on its region, transfer basis and sub-processors still match its pages.
- **Sign-in sessions**: the notice says Supabase Auth keeps time, IP address and browser of sign-ins. That is what its
  session and audit tables hold today; check again after an upgrade.
- **Email**: the notice promises that a deleted waitlist entry goes on request (`owner_waitlist_delete`, the Waitlist
  screen) and that a data export is "on request by email" until the in-app export exists. Remove that sentence when the export ships.
- **Ages**: "not for under 16" is a choice, not a legal limit; keep or change it.
- **Social (V1 and V2a)**: the notice covers following, blocking, the follow link and its visitors, the activity followers
  see and the reading page. When V2a adds data (anything new that is stored or shown to others), add it to "What data I
  process" and bump the version date.

## Whenever the app changes what it does with data

A new third-party service, a new kind of stored data, a new log, a new place where something is shown to other people:
change `web/app/legal/privacy.ts` in both languages and the version line, and tell the members what changed (the notice
promises it). The README's "Privacy" section and docs/THIRD-PARTY.md say the same things in the repository's words.
