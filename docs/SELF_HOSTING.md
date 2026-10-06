# Self-hosting Libellus

Your own Libellus: a Supabase project for the data and sign-in, and the web app as static files on
Cloudflare Pages (or any static host). Both have free tiers that are plenty for a handful of
readers. Plan on an hour, most of it in two dashboards.

What you end up with: an instance at your own address where sign-up needs an invite code you mint,
sign-in is a six-digit code by email, and every member's Library is hers alone.

Contents: [What you need](#what-you-need) · [1. Supabase](#1-supabase) ·
[2. Email](#2-email) · [3. The web app on Cloudflare Pages](#3-the-web-app-on-cloudflare-pages) ·
[4. Your address](#4-your-address) · [5. The first account](#5-the-first-account) ·
[Optional pieces](#optional-pieces) · [Every setting](#every-setting) · [Updating](#updating) ·
[What was verified](#what-was-verified)

## What you need

- A [Supabase](https://supabase.com) account and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
- A [Cloudflare](https://cloudflare.com) account (or another static host, see below).
- An SMTP account to send the sign-in codes from (Resend, Postmark, Amazon SES, your mail host, …).
- Node 24 and pnpm, Python 3 and curl (the invite script), and a fork or clone of this repository.

Run everything below from the repository's root unless it says otherwise.

## 1. Supabase

1. **Create a project** in the Supabase dashboard (any region; the owner's is `eu-central-1`). Note
   its **project ref** (the `<ref>` in `https://<ref>.supabase.co`) and the database password.
2. **Link and push the schema.** The migrations in `supabase/migrations/` create everything: tables,
   rules, row-level security and the functions the app calls.

   ```sh
   supabase login
   supabase link --project-ref <ref>
   supabase db push              # applies supabase/migrations/*, in order
   ```

   They also enable the extensions they need (`citext`, `unaccent`, `pg_cron`; `pg_net` when it is
   available). `pg_cron` runs two clean-ups: sign-ups that never proved their address (hourly) and
   the record of synced offline writes (daily). Nothing else needs to be switched on.
   `supabase/seed.sql` (the local dev invite and member) is **not** pushed: it only runs locally.
3. **Auth settings** (Authentication in the dashboard). Libellus signs in with a six-digit code,
   never a link, so the code stays inside the installed app.
   - *Sign In / Providers → Email*: Email enabled; **Confirm email on**; **Email OTP length 6**;
     Email OTP expiration 3600 seconds. Every other provider off.
   - *Sign In / Providers → User Signups*: **Allow new users to sign up on**. That is safe: the
     invite check is in the database (a sign-up without a valid code is rolled back), so nobody gets
     in without a code you made.
   - *URL Configuration*: **Site URL** `https://<your address>`; add it (and
     `https://<project>.pages.dev` if you use that address too) under Redirect URLs. The codes don't
     use links, but Supabase builds a few addresses from these.
   - *Emails → Templates*: for **Magic Link** and for **Confirm signup**, subject
     `Your Libellus sign-in code` and the body of `supabase/templates/magic_link.html` (it shows
     `{{ .Token }}`, the six digits, and no link). Both need it: the first mail of a sign-up is the
     confirmation, every later one the magic link. Supabase lets you edit the templates once
     custom SMTP is set up (step 2).
4. **Keys.** *Project Settings → API keys*: the **Project URL** and the **anon** (publishable) key
   go into the web app (step 3); they are public, the database's row-level security decides what
   they can do. The **service_role** (secret) key is only for your own scripts (step 5): never put
   it into the web app or anywhere it could be read.

Free-tier projects are paused after a week without any request; a paused project is woken up from
the dashboard.

## 2. Email

Supabase's built-in mail only delivers to your project's team members and only a few an hour, so
real members need your own SMTP server: *Authentication → Emails → SMTP Settings* → Enable custom
SMTP, with your provider's host, port, user and password, a **sender address** on a domain you have
verified with that provider (e.g. `books@example.org`) and a **sender name** (e.g. `Libellus`).
Then set the templates (step 1.3). Send yourself a code from the app (step 5) to check it arrives.

## 3. The web app on Cloudflare Pages

*Workers & Pages → Create → Pages → Connect to Git*, pick your fork, then:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Root directory | `web` |
| Build command | `pnpm generate` |
| Build output directory | `dist` |
| Environment variable `NODE_VERSION` | `24` |
| Environment variable `NUXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| Environment variable `NUXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key |

Put the two Supabase values on **Production** only if branch previews should not reach your data
(they then show the signed-out screens and cannot sign in); the owner's instance does that. Nothing
else is required: without `LIBELLUS_REGAL` the build has no private dependencies. The optional
variables are in [Every setting](#every-setting).

Save and deploy. Pages builds every push to your production branch, and a preview of every other
branch. `web/public/_headers` gives the app its security and cache headers; its
Content-Security-Policy only reports (nothing is blocked) and names `*.supabase.co`, so a Supabase
on a custom domain needs adding to `connect-src` before you ever enforce it.

**Another static host** works the same: build with `pnpm install && pnpm generate` in `web/`, serve
`web/.output/public` (also linked as `web/dist`), and answer every unknown path with `200.html` (the
app shell, it routes in the browser) or `404.html`. The two `NUXT_PUBLIC_*` variables have to be set
in the build's environment: they are baked into the files.

## 4. Your address

In the Pages project, *Custom domains → Set up a domain*, and follow it (on a zone in the same
Cloudflare account it adds the DNS record itself; elsewhere a `CNAME` to `<project>.pages.dev`).
Then put the address into Supabase's Site URL and Redirect URLs (step 1.3). The app needs nothing
else: it uses relative addresses and asks Supabase at the URL it was built with.

## 5. The first account

Libellus is invite-only, so the first code comes from the service-role key, on your machine:

```sh
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<the service_role key>
scripts/create-invite-code.sh --label "me"                 # one use, 14 days; prints the code
```

Open your address, **Sign up** with your email and the code, and type the six digits from the mail.
The code is spent once the address is proved. Make more the same way for the people you invite
(`--uses 5 --days 30`, `--code HELLO-BOOKS`, `--days 0` for never expiring); `--help` says the rest.
A code with many uses and no expiry, shared openly, is as close to open sign-up as Libellus gets.

Install it: Share → Add to Home Screen on an iPhone, Install app in Chrome on Android.

## Optional pieces

**Goodreads rating** under a Book's facts. The `goodreads-rating` edge function asks Goodreads
server-side and caches the answer for 30 days (`supabase/functions/goodreads-rating/README.md`):

```sh
supabase functions deploy goodreads-rating                       # verify_jwt = false comes from supabase/config.toml
supabase secrets set LIBELLUS_SITE_URL=https://<your address>    # optional: named in its User-Agent
```

Without it the line simply never shows. Deploy functions by name: `supabase functions deploy` alone
would also deploy `regal-export`, which only the owner's instance uses.

**Book links for everyone.** Each member keeps her own Book links in the Profile (stored in the
database, private to her). An instance can add links every member sees first, built into the app:

```sh
NUXT_PUBLIC_LINK_TEMPLATES='[{"label":"Open Library","url":"https://openlibrary.org/isbn/{isbn}"},{"label":"City library","url":"https://catalogue.example.org/search?q={title}%20{author}"}]'
```

Placeholders: `{isbn}` (ISBN-13), `{isbn10}`, `{title}`, `{author}` (the first author), each
URL-encoded; a link whose placeholder a Book cannot fill is left out for that Book. Addresses must
be `http(s)`. This value is **public**: like every `NUXT_PUBLIC_*` setting it ends up in the built
files, readable by anyone who loads the site. Put nothing there you would not publish.

**Analytics.** Cloudflare Web Analytics (cookieless, no identifiers) can be switched on in the
Pages project (*Metrics → Web Analytics*); Pages then adds its beacon to every page. Off unless you
switch it on. `docs/HOSTING.md` describes the owner's setup.

**Regal, the 3D shelf** is the owner's private Nuxt layer; a fork builds without it and loses
nothing else. It needs `LIBELLUS_REGAL=1`, access to the private repository (`GIGET_AUTH`), a
published library file and the owner's user id (table below). Its data feed (`regal-export`, the
`shelf_publish` trigger with `pg_net` and a Vault secret) does nothing until configured:
[OWNER.md](OWNER.md).

**Android app (Play Store)** as a Trusted Web Activity is planned, not part of the repository yet.

## Every setting

Everything that differs between instances. Nothing in the app's code depends on the owner's
instance, and the owner-only parts are off by default. (One harmless trace: the report-only
Content-Security-Policy in `web/public/_headers` also names the owner's shelf host.)

| Where | Setting | Default | What it is |
| --- | --- | --- | --- |
| Web build env | `NUXT_PUBLIC_SUPABASE_URL` | none (required) | Your Supabase project's URL. |
| Web build env | `NUXT_PUBLIC_SUPABASE_ANON_KEY` | none (required) | Its anon (publishable) key. Public. |
| Web build env | `NODE_VERSION` (Pages) | Pages' default | `24`. |
| Web build env | `NUXT_PUBLIC_LINK_TEMPLATES` | empty | Book links for every member, JSON (above). Public. |
| Web build env | `LIBELLUS_REGAL` | unset (off) | `1` builds with the owner's Regal layer. Owner only. |
| Web build env | `GIGET_AUTH` or `REGAL_LAYER` | unset | Where Regal comes from: a GitHub token that can read fabkho/regal, or a local checkout. Owner only. |
| Web build env | `NUXT_PUBLIC_REGAL_LIBRARY_SRC` | empty | The published library file Regal shows. Required with `LIBELLUS_REGAL=1`. Owner only. |
| Web build env | `NUXT_PUBLIC_SHELF_OWNER_ID` | empty (nobody) | The auth user id that sees Your shelf, with Regal only. Owner only. |
| Supabase Auth | Site URL, Redirect URLs | `http://127.0.0.1:3020` locally | Your address (step 1.3, 4). |
| Supabase Auth | Confirm email, Email OTP length | on, 6 | As in `supabase/config.toml` (step 1.3). |
| Supabase Auth | User sign-ups | on | Leave on; invite codes gate sign-up in the database. |
| Supabase Auth | Email templates | Supabase's | Magic Link and Confirm signup from `supabase/templates/magic_link.html` (step 1.3). |
| Supabase Auth | SMTP host, port, user, password, sender address and name | Supabase's (team only) | Your mail provider (step 2). |
| Invite codes | `scripts/create-invite-code.sh` | none | Uses, expiry, label, the code itself (step 5). Locally `LIBELLUS-DEV` is seeded. |
| Function secrets | `LIBELLUS_SITE_URL` | unset | `goodreads-rating`: your address, named in its User-Agent. Optional. |
| Function secrets | `REGAL_EXPORT_TOKEN`, `REGAL_OWNER_EMAIL`, `REGAL_OWNER_NAME`, `REGAL_*` | unset | `regal-export`, owner only ([OWNER.md](OWNER.md)). |
| Database | `private.shelf_publish.owner_id`, Vault `github_dispatch_token` | empty | The shelf's publish trigger, owner only; does nothing while empty. |
| Pages project | Custom domain, Web Analytics | none, off | Step 4; Optional pieces. |
| Source | App name, icons, colours | Libellus, "Night Reader" | Not settings: `web/nuxt.config.ts` (`pwa.manifest`), `web/i18n/locales/en.json` (`app.name`), `design/tokens.json`, `design/icons/`. |

`web/.env.example` lists the web build's variables for local work.

## Updating

Pull the new commits into your fork. Then, in this order:

1. `supabase db push`: new migrations first. They only ever add (new tables, columns, functions)
   or change functions, so the running app keeps working with the new schema.
2. `supabase functions deploy goodreads-rating`, when `supabase/functions/goodreads-rating/` changed.
3. Push to your production branch: Pages builds and deploys the app. Installed apps pick up the new
   version on their next start (the service worker updates itself).

`git log --stat -- supabase/` shows what changed on the database side.

## What was verified

Checked for this guide: the migrations apply in order onto an empty database (CI does it on every
pull request with a fresh `supabase start`, and the pgTAP, Vitest and Playwright suites run against
the result); the web app builds with `pnpm generate` without any private dependency (no Regal, no
`GIGET_AUTH`; also a CI step on every pull request); the auth values (code length, confirmation, templates) are
the ones in `supabase/config.toml`, which the local stack and its tests use; the Pages build
settings are the owner's live ones (docs/HOSTING.md).

Not verified end to end: a brand-new hosted Supabase project (the dashboard's labels move now and
then), SMTP delivery through a particular provider, the custom-domain flow, and a fresh Pages
project. If a step reads differently in a dashboard today, an issue or a pull request is welcome.
