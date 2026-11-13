Title: Launch: privacy notice, community rules and a moderation runbook
Labels: priority:low (tracked in #331)
Package: WP-27 · launch (revision 2) · tier postponed (#331) · size S–M · model Sonnet (the owner reviews the legal text) · depends on: none (after the BetterReads rename, or it does the legal-text name swap itself) · postponed
Create: do not; this package is tracked in issue #331 (https://github.com/fabkho/libellus/issues/331).
Plan: docs/plans/backlog-execution.md

---
**Status: postponed with open sign-up, bundled in issue #331 (https://github.com/fabkho/libellus/issues/331). Do not create a separate issue and do not start until the owner opens #331.**

## Problem
The legal and operations texts assume an invite-only beta: "run as an invite-only beta" (`web/app/legal/privacy.ts:13`), the invite code as account data (`:32`), the waitlist (`:37`, `:55`, `:111`), `SPEC.md:17,41` and the out-of-scope "open sign-up" (`SPEC.md:24`). Reports (WP-25) and a captcha (WP-24) are new processing; there are no community rules and no moderation runbook.

## Scope
- **Privacy notice** (EN and DE, new version date): drop the invite-only lines; invite code optional; waitlist per WP-24; add **reports** (what is stored, who reads it, how long, legal basis); the captcha provider as a processor; the age line consistent with sign-up.
- **Community rules:** a short page in the `legal/` machinery (EN and DE): not allowed (impersonation, harassment, spam, sexual content, minors), what the owner can do (clear a name, photo or review; suspend), how to report. Linked from sign-up and from the report sheet.
- **`docs/OPERATIONS.md` moderation runbook:** reading reports, each owner action from WP-25, ban/unban in the Supabase dashboard, telling a member why, the incident switch back to invite-only (WP-24), Supabase and Resend usage thresholds and when to upgrade from the Free plan.
- **`docs/legal-checklist.md`:** DSA notice-and-action, the age decision, the new processor.
- **`SPEC.md`:** Access and out-of-scope.

## Acceptance criteria
- [ ] No "invite-only" claim left in user-facing legal text (EN and DE).
- [ ] Reports and the captcha are in the notice in both languages.
- [ ] The community rules page exists and is linked from sign-up and the report sheet.
- [ ] The runbook covers every owner action of WP-25.
- [ ] `tests/legal.test.ts` green (no placeholders); i18n parity green.

## Notes
- Not legal advice: the owner reviews before launch.
- Owner questions: a postal address before launch (`docs/legal-checklist.md:17` recommends one); report retention (recommended: 12 months after handling); the wording of the rules in the owner's voice.
