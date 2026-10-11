# Legal pages: checklist for the owner

The privacy notice (`/privacy`) is a **draft**: written against what the app does, **not legal advice**, and not
reviewed by a lawyer. The full imprint (`/imprint`) is **postponed** (below): the friends round ships with the privacy
notice only. Both pages carry English and German text on the same page (`web/app/legal/`), because the app's own German
catalogue does not exist yet (issue #257). While a placeholder is left in the text, the page shows a "Draft" note; it
goes away by itself when the last one is filled.

## Placeholders to fill in

Each is written as `[[…]]` in `web/app/legal/` and drawn marked on the page. `web/tests/legal.test.ts` fails when
this list and the texts of the pages that are on disagree, so a new placeholder cannot slip in unlisted.

| Placeholder | What goes there | Where it is used |
| --- | --- | --- |
| `[[EMAIL ADDRESS]]` | An address you read; the privacy notice promises an answer within a month | Privacy notice (who is responsible, rights) |
| `[[SUPERVISORY AUTHORITY]]` | The data protection authority of your federal state, with its address | Privacy notice (rights) |
| `[[VERIFY RESEND REGION AND TRANSFER BASIS]]` | Where Resend processes the mail (its dashboard shows the sending region) and which transfer basis its data processing agreement gives (EU-U.S. Data Privacy Framework, standard contractual clauses) | Privacy notice (recipients) |

To fill one: replace it in `web/app/legal/placeholders.ts` (one place, used by both languages), and delete its row here.
Nothing else.

**A postal address is customary** and recommended before a wider launch. Art. 13 GDPR asks the notice for the
controller's identity and contact details, which the name and the e-mail address give; most notices add the postal
address too. It comes back with the imprint (below), or earlier by hand: add `X.address` to the "Who is responsible"
lines in `privacy.ts`.

## The imprint is postponed: what turning it on needs

The owner decided to leave the full imprint (Impressum, § 5 DDG) out of the friends round. Its text stays in
`web/app/legal/imprint.ts` and the postal address stays in `privacy.ts`, both inactive behind one constant,
`IMPRINT_ENABLED` in `web/app/legal/config.ts` (`false`). While it is `false`, `/imprint` is an address that does not
exist (a 404 for a signed-in member, the sign-in for anyone else), nothing links to it (the sign-in, sign-up and verify
screens and the Profile show "Privacy" alone), and the privacy notice names its controller by name and e-mail only.

To turn it on:

1. Fill the two placeholders it brings back, in `web/app/legal/placeholders.ts`, and list them in the table above
   (the test requires it): `[[STREET, POSTCODE, CITY]]` (your postal address; a P.O. box does not satisfy § 5 DDG) and
   `[[PHONE OR CONTACT FORM]]` (a second, fast way to reach you: a phone number, or a contact form if you build one).
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
  terms are accepted; the R2 bucket `libellus-backups` has its location hint `weur` and the 35-day rule.
- **Resend**: the data processing agreement is accepted (see the placeholder above).
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
