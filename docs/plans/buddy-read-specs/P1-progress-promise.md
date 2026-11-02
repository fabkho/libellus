# P1 · Her Section is the one thing about her reading that a buddy read shows (the promise removed)

**Repo / branch:** libellus, `docs/progress-promise` off `origin/main`. **Tier:** normal. **Size:** M. **Depends on:** nothing to write; **merge it with the release that carries the buddy reads** (the privacy notice must not describe a feature that has not shipped, nor the feature ship without the notice). The owner reads and approves the EN and DE wording before it merges.

## Task

The owner decided that the old promise "a member's progress never leaves her own account" is wrong. Her progress stays out of every follower-facing and public surface, and is visible **only as a Section, only to the members of a buddy read she joined, only while she is in it**. Change every place that makes or implies the old promise, exactly as listed in `docs/plans/buddy-read-shared.md` **part 6.1** (items 1–16; item 17 `CONTEXT.md` is D1's, item 18 is the screens' PRs). Read first: that part (it has the file:line, the old text and the EN/DE replacement for each), part 5.5 (what a co-member can and cannot see: the wording must match it), `docs/legal-checklist.md`, `web/tests/legal.test.ts`.

## Change

1. `web/i18n/locales/en.json` and `de.json`, key `privacy.never` (line 1999 in both): replace as item 1; run `pnpm i18n:translate`, read the diff, commit `en.json`, `de.json` and `web/.i18n-kit.lock.json`. (The sheet that draws it is `web/app/components/friends/PrivacySheet.vue:90`; no code change.)
2. `web/app/legal/privacy.ts`, English and German together (items 4–10): the new **Buddy reads** paragraph after the Friends paragraph (EN `:36`, DE `:180`); the appended clause in **Your reading data** (`:35`/`:179`); the legal basis (`:55`/`:199`) and "what you show to others" (`:56`/`:200`); **Other members** (`:76`/`:220`); retention (`:111`/`:255`) with the ended-read line; the version lines (`:14` and `:158`) set to the date of the release. Same sections, same order in both languages (`web/tests/legal.test.ts` checks it).
3. `SPEC.md:165–168` (item 3, and a *Buddy reads* bullet), `README.md` lines 16 and 22 (items 11, 12; the README holds one line per service and no setup: `AGENTS.md`), `docs/parity.md:619` (item 2), `docs/proposals/social.md:247, 300, 660` (items 13–15), `docs/proposals/social-v1-contract.md:672` (item 16).
4. `docs/legal-checklist.md`: add the buddy-read paragraph to the list of notice sections if the checklist enumerates them.

## Not in it

Any code other than the two locale files. `CONTEXT.md` (D1). The `docs/parity.md` entries for buddy-read screens (W-PRs). `docs/THIRD-PARTY.md` and the KLIPY lines (K1). **Do not edit** the applied migration `supabase/migrations/20261017040000_social_readers.sql` (its comment stays; part 6.2 explains). Do not "fix" the follower-facing statements listed in part 6.2: they are true.

## Constraints

- Say precisely what a co-member can and cannot see: **a Section** (never a page, a percent or a date), **only** members of a room she joined, **only** while she is in it; leaving or removal stops it; the Profile switch is not a privacy control. Wording must be consistent with part 5.5.
- Informal "du" in German; product words *Buddy-Read*, *Abschnitt*; never a placeholder `[[…]]` left in the notice (`legal.test.ts`).
- The notice is a draft, not legal advice (`docs/legal-checklist.md`): do not add legal claims beyond the items.
- Conventional title: `docs(legal): her Section is the one thing about her reading that a buddy read shows`.

## Ownership

`web/app/legal/privacy.ts`, `web/i18n/locales/{en,de}.json` (the `privacy.never` key only), `web/.i18n-kit.lock.json`, `SPEC.md`, `README.md`, `docs/parity.md` (line 619 only), `docs/proposals/social.md`, `docs/proposals/social-v1-contract.md`, `docs/legal-checklist.md`. W1 adds other keys to the same locale files: merge after W1 and re-run `pnpm i18n:translate`.

## Tests

`pnpm test` in `web/` (Vitest; `tests/legal.test.ts`: same sections in English and German, a version in both, no stray placeholders, only paths/https/mailto links); `pnpm i18n:verify` (parity). The docs-only files trigger no CI run on their own; the code paths here do. No pgTAP, no Playwright.

## Observable acceptance

- `grep -rnI "never shown\|nie sichtbar\|never leaves" web/i18n SPEC.md README.md web/app/legal docs/parity.md docs/proposals` shows only follower-scoped sentences that name followers (part 6.2) and nothing that says progress never leaves.
- The privacy notice has the Buddy reads paragraph in both languages with the new version date; `legal.test.ts` and `i18n:verify` green.
- The owner has read the EN and DE of items 1, 4–9, 11–12 (owner action O6).
