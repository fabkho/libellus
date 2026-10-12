Title: Launch: open sign-up safely (invite gate off, captcha, email budget, photo cap, age line)
Labels: priority:low (tracked in #331)
Package: WP-24 · launch (revision 2) · tier postponed (#331) · size M · model Opus · depends on: none (check first whether the owner's launch work already covers it) · postponed
Create: do not; this package is tracked in issue #331 (https://github.com/fabkho/libellus/issues/331).
Plan: docs/plans/backlog-execution.md

---
**Status: postponed with open sign-up, bundled in issue #331 (https://github.com/fabkho/libellus/issues/331). Do not create a separate issue and do not start until the owner opens #331.**

## Problem
When the owner opens sign-up (#331, postponed). Today the invite gate is the only brake on sign-ups and on mail to unknown addresses:
- `public.signup_invite` and its `auth.users` triggers refuse a sign-up without a valid code and roll the auth user back, so no code is mailed (`supabase/migrations/20261002190000_invites_and_accounts.sql`). The client passes `data: { invite_code }` (`web/app/data/auth.ts:167-178`); sign-in uses `shouldCreateUser: false` (`:141-146`).
- No captcha: `[auth.captcha]` is commented out (`supabase/config.toml:216-220`).
- Sign-in is a six-digit code, no password: **every sign-in is an email** (Resend, per `web/app/legal/privacy.ts:71`), through Supabase Auth's email rate limit.
- The `avatars` insert policy accepts any number of files per member (`20261009120000_avatars.sql:59-63`), on a Free plan with 1 GB of files.
- The notice says "not for under 16" (`privacy.ts:138`), but sign-up asks nothing.

## Scope
- **Gate:** a `signup_mode` setting (`open` | `invite`, **default `invite`**, so merging changes nothing until the owner flips it) read by `signup_invite`, so the owner can close sign-up again with one statement in an incident; a code given anyway is still recorded (`accounts.invite_code_id`).
- **Sign-up screen** (`web/app/pages/sign-up.vue`): no code field in open mode; a required "I am 16 or older" check.
- **Captcha:** Cloudflare Turnstile via Supabase Auth captcha (`provider = "turnstile"`); the token on every `signInWithOtp` call (sign-in and sign-up both send mail). `docs/SETUP.md`: site key (build config) and secret (Supabase dashboard).
- **Email budget** (owner dashboard steps written into `docs/OPERATIONS.md`): Supabase Auth email rate limit and per-address frequency, Resend plan quota and domain warm-up, the arithmetic (every sign-in is a mail).
- **Photo cap:** the avatars insert policy also requires fewer than N objects in `<uid>/` (e.g. 4).
- **Waitlist:** the reading page's form (`components/reading/Waitlist.vue`) becomes a "Sign up" link; `join_waitlist`, the Waitlist page and `waitlist-invite` kept for existing entries or retired (owner's call).
- `SPEC.md` (Access), `docs/parity.md` (Sign up, Verify, Waitlist).
- Keys: `signUp.ageConfirm` ("I am 16 or older" / "Ich bin mindestens 16 Jahre alt"), captcha errors, `signUp.intro` without "invite-only".

## Acceptance criteria
- [ ] A new address signs up without a code; an invite code still works if given.
- [ ] Without a valid captcha token, no mail is sent (sign-in and sign-up).
- [ ] The owner can switch back to invite-only with one statement, documented in OPERATIONS.
- [ ] The age line is required to sign up.
- [ ] A member's fifth avatar object is refused.
- [ ] The email budget is written down with the dashboard values.
- [ ] pgTAP: open and invite mode, the confirmation trigger, the avatar cap; Vitest: the auth repository passes the token; `e2e/auth.spec.ts` locally only.

## Notes
- Serialize with WP-26 (both add migrations around `auth.users` triggers).
- Owner questions: keep invite codes at all; the waitlist; Turnstile vs hCaptcha; the Resend plan.
