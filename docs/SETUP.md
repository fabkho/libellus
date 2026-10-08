# Setting up the owner's instance

How the one Libellus instance (libellus.fabkho.dev) is put together, as steps its owner takes once:
a Supabase project for the data and sign-in, and the web app as static files on Cloudflare Pages.
Both are on free tiers that are plenty for a handful of readers. The same steps stand up a
replacement when the hosted project is gone ([OPERATIONS.md, Restoring](OPERATIONS.md#restoring));
what runs where today is in [HOSTING.md](HOSTING.md).

What it ends up as: an instance at its address where sign-up needs an invite code the owner mints,
sign-in is a six-digit code by email, and every member's Library is hers alone.

Contents: [What you need](#what-you-need) · [1. Supabase](#1-supabase) ·
[2. Email](#2-email) · [3. The web app on Cloudflare Pages](#3-the-web-app-on-cloudflare-pages) ·
[4. The address](#4-the-address) · [5. The first account](#5-the-first-account) ·
[Optional pieces](#optional-pieces) · [Every setting](#every-setting) · [Updating](#updating) ·
[What was verified](#what-was-verified)

## What you need

- A [Supabase](https://supabase.com) account and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
- A [Cloudflare](https://cloudflare.com) account (or another static host, see below).
- An SMTP account to send the sign-in codes from (any transactional mail provider, or a mail host).
- Node 24 and pnpm, Python 3 and curl (the invite script), and a clone of this repository.

Run everything below from the repository's root unless it says otherwise.

## 1. Supabase

1. **Create a project** in the Supabase dashboard (the instance's is in `eu-central-1`). Note
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
   They also create the one **Storage bucket**, `avatars` (private, 256 kB a file, WebP and JPEG),
   with its policies: a member's profile photo (#156), which only she can read or change. Storage is
   on in every Supabase project; there is nothing to set up in the dashboard, and the photos are not
   in the nightly backup ([OPERATIONS.md](OPERATIONS.md#backups)).
   `supabase/seed.sql` (the local dev invite and member) is **not** pushed: it only runs locally.
3. **Auth settings** (Authentication in the dashboard). Libellus signs in with a six-digit code,
   never a link, so the code stays inside the installed app.
   - *Sign In / Providers → Email*: Email enabled; **Confirm email on**; **Email OTP length 6**;
     Email OTP expiration 3600 seconds. Every other provider off.
   - *Sign In / Providers → User Signups*: **Allow new users to sign up on**. That is safe: the
     invite check is in the database (a sign-up without a valid code is rolled back), so nobody gets
     in without a code the owner made.
   - *URL Configuration*: **Site URL** `https://<the address>`; add it (and
     `https://<project>.pages.dev` if that address is used too) under Redirect URLs. The codes don't
     use links, but Supabase builds a few addresses from these.
   - *Emails → Templates*: for **Magic Link** and for **Confirm signup**, subject
     `Your Libellus sign-in code` and the body of `supabase/templates/magic_link.html` (it shows
     `{{ .Token }}`, the six digits, and no link). Both need it: the first mail of a sign-up is the
     confirmation, every later one the magic link. Supabase lets you edit the templates once
     custom SMTP is set up (step 2). The body is a designed mail (Libellus' wordmark, colours and
     code cell, light and dark), so paste the whole file, from `<!doctype html>` to `</html>`, into
     the dashboard's HTML source field, not a rewrite of it. It is generated from
     `design/tokens.json` (`cd design && pnpm emails`; [DEVELOPMENT.md](DEVELOPMENT.md#emails)): when
     the design or its copy changes, paste the new file again into both templates. The subject lives
     only in the dashboard (and in `supabase/config.toml` for the local stack); the file does not
     carry it. `cd web && pnpm email:preview` shows how it looks, with a sample code, before it is pasted.
4. **Keys.** *Project Settings → API keys*: the **Project URL** and the **anon** (publishable) key
   go into the web app (step 3); they are public, the database's row-level security decides what
   they can do. The **service_role** (secret) key is only for the owner's scripts (step 5): never put
   it into the web app or anywhere it could be read.

Free-tier projects are paused after a week without any request; a paused project is woken up from
the dashboard.

## 2. Email

Supabase's built-in mail only delivers to the project's team members and only a few an hour, so
real members need an SMTP server of the owner's: *Authentication → Emails → SMTP Settings* → Enable
custom SMTP, with the provider's host, port, user and password, a **sender address** on a domain
verified with that provider (e.g. `books@example.org`) and a **sender name** (e.g. `Libellus`).
Then set the templates (step 1.3). Send yourself a code from the app (step 5) to check it arrives.

## 3. The web app on Cloudflare Pages

*Workers & Pages → Create → Pages → Connect to Git*, pick `fabkho/libellus`, then:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Root directory | `web` |
| Build command | `pnpm generate` |
| Build output directory | `dist` |
| Environment variable `NODE_VERSION` | `24` |
| Environment variable `NUXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| Environment variable `NUXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key |

Put the two Supabase values on **Production** only if branch previews should not reach the data
(they then show the signed-out screens and cannot sign in); the instance does that. Nothing
else is required: without `LIBELLUS_REGAL` the build has no private dependencies. The optional
variables are in [Every setting](#every-setting).

Save and deploy. Pages builds every push to its production branch, and a preview of every other
branch. `web/public/_headers` gives the app its security and cache headers; its
Content-Security-Policy only reports (nothing is blocked) and names `*.supabase.co`, so a Supabase
on a custom domain needs adding to `connect-src` before you ever enforce it.

**Another static host** works the same: build with `pnpm install && pnpm generate` in `web/`, serve
`web/.output/public` (also linked as `web/dist`), and answer every unknown path with `200.html` or
`index.html` (the app shell, it routes in the browser; status 200, a host that answers with a 404
shows the same page but a wrong status to link previews and crawlers). The build has no
`404.html`; Pages' SPA fallback depends on that. The two `NUXT_PUBLIC_*` variables have to be set
in the build's environment: they are baked into the files.

## 4. The address

In the Pages project, *Custom domains → Set up a domain*, and follow it (on a zone in the same
Cloudflare account it adds the DNS record itself; elsewhere a `CNAME` to `<project>.pages.dev`).
Then put the address into Supabase's Site URL and Redirect URLs (step 1.3). The app needs nothing
else: it uses relative addresses and asks Supabase at the URL it was built with.

## 5. The first account

Libellus is invite-only, so the first code comes from the service-role key, on the owner's machine:

```sh
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<the service_role key>
scripts/create-invite-code.sh --label "me"                 # one use, 14 days; prints the code
```

Open the address, **Sign up** with the owner's email and the code, and type the six digits from the mail.
The code is spent once the address is proved. More are made the same way for the people invited
(`--uses 5 --days 30`, `--code HELLO-BOOKS`, `--days 0` for never expiring); `--help` says the rest.
A code with many uses and no expiry, shared openly, is as close to open sign-up as Libellus gets.

Install it: Share → Add to Home Screen on an iPhone, Install app in Chrome on Android. Then name the
owner, in the database and in the web build, once ([OPERATIONS.md, The owner](OPERATIONS.md#the-owner)).

## Optional pieces

**Goodreads rating** under a Book's facts. The `goodreads-rating` edge function asks Goodreads
server-side and caches the answer for 30 days (`supabase/functions/goodreads-rating/README.md`):

```sh
supabase functions deploy goodreads-rating                       # verify_jwt = false comes from supabase/config.toml
supabase secrets set LIBELLUS_SITE_URL=https://<the address>    # optional: named in its User-Agent
```

Without it the line simply never shows. Deploy functions by name: `supabase functions deploy` alone
would also deploy `regal-export`, which only the owner's instance uses.

**Link previews of a shared reading page.** A member can turn on a public reading page and hand out
its link (#171). The page and its Book cards work without anything extra; what the `reading-page-og`
edge function adds is the picture a chat app shows beside the link
(`supabase/functions/reading-page-og/README.md`):

```sh
supabase functions deploy reading-page-og                         # verify_jwt = false, fonts bundled: both from supabase/config.toml
```

No secrets: the runtime provides `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Without it the preview
falls back to the Book's cover or the app icon.

**Invites from the waitlist.** A reading page's visitors can leave their address; the owner reads them in
Profile → Account → Waitlist ([OPERATIONS.md, Waitlist](OPERATIONS.md#waitlist)). Its **Invite** button asks the `waitlist-invite`
edge function, which gets the entry a one-use code, mails it over SMTP and marks the entry invited
(`supabase/functions/waitlist-invite/README.md`). The mail is designed like the sign-in code's (the
same generated shell, light and dark, docs/DEVELOPMENT.md "Emails") and travels with the function:
nothing to paste in a dashboard. Any SMTP service works (the one from step 2 will do);
hosted Supabase blocks outgoing ports 25 and 587, so use 465 or the provider's alternative port:

```sh
supabase functions deploy waitlist-invite                        # verify_jwt = true comes from supabase/config.toml
supabase secrets set SMTP_HOST=<smtp host> SMTP_PORT=465 SMTP_USER=<user> SMTP_PASS=<password> \
  SMTP_FROM=<invites@the domain> SMTP_FROM_NAME=Libellus      # SMTP_FROM_NAME is optional
supabase secrets set LIBELLUS_SITE_URL=https://<the address>    # optional: the sign-up link in the mail
```

Without the SMTP secrets the Invite button still mints the code and shows it to the owner to send another way
(the entry stays waiting); without the function it says the invite could not be made, and Mark invited
and Copy waiting emails work as before.

**Book links for everyone.** Each member keeps her own Book links in the Profile (stored in the
database, private to her). An instance can add links every member sees first, built into the app:

```sh
NUXT_PUBLIC_LINK_TEMPLATES='[{"label":"Open Library","url":"https://openlibrary.org/isbn/{isbn}"},{"label":"City library","url":"https://catalogue.example.org/search?q={title}%20{author}"}]'
```

Placeholders: `{isbn}` (ISBN-13), `{isbn10}`, `{title}`, `{author}` (the first author), each
URL-encoded; a link whose placeholder a Book cannot fill is left out for that Book. Addresses must
be `http(s)`. This value is **public**: like every `NUXT_PUBLIC_*` setting it ends up in the built
files, readable by anyone who loads the site. Put nothing there you would not publish.

**Analytics.** Cloudflare Web Analytics (cookieless, no identifiers) is switched on in the Pages
project (*Metrics → Web Analytics*); Pages then adds its beacon to every page. A new Pages project
has none until it is switched on again. `docs/HOSTING.md` describes the instance's setup.

**Ebook files** (#131) need nothing set up: members share EPUBs to the installed app, pick an
ebook folder or add a file on a Book page, and the app copies each file into the browser's own
storage on that device and links it to a Book there. **The files never leave the device**: nothing
is uploaded to the Supabase project or anywhere else, nothing about them is stored on the server,
and signing out deletes them from the device. The share target needs HTTPS and the installed app
(Chrome on Android); `web/functions/share.js` is a Cloudflare Pages Function that only redirects a
share arriving before the service worker is installed (no data passes through it). On another host
that does not run it, such a share is answered with an error and the member shares again.

**The reader** (#131 phase 2) reads those copies in the browser. Two of its features ask outside
services, and only with the words the member selected and asked about: *Translate* uses the
browser's own on-device translator where there is one (Chrome) and otherwise MyMemory's free API
(`api.mymemory.translated.net`, no key, a daily quota per address), and *Define* asks Wiktionary
(`en.wiktionary.org`). Nothing else of a book leaves the device. The place in each book is kept in
the Supabase project (`reader_places`: the entry, a position in the file and its fingerprint;
never any text) so another device opens at the same page. So are the member's **highlights**
(`reader_highlights`: the entry, the range in the file, its colour, the words she selected cut at
1000 characters, an optional note and the file's fingerprint; hers alone by RLS, removed with the
entry or the account): her own reading, so another device with the same file shows them. They are
the only words of a book that reach the project, only the ones she chose to mark; the book and
the file never do. A removed highlight stays as an empty tombstone (no words). The
Content-Security-Policy in `web/public/_headers` names both hosts and allows the book's pages as
`blob:` frames. A book is markup from anywhere: before a page is shown it is sanitized (DOMPurify),
it carries its own `script-src 'none'` policy, and its frame runs no script where the browser allows
that (not WebKit), so a crafted EPUB cannot act as the member (`web/app/data/reader/markup.ts`).

**Regal, the 3D shelf** is the owner's private Nuxt layer; the app builds without it and loses
nothing else. It needs `LIBELLUS_REGAL=1`, access to the private repository (`GIGET_AUTH`), a
published library file and the owner's user id (table below). Its data feed (`regal-export`, the
`shelf_publish` trigger with `pg_net` and a Vault secret) does nothing until configured:
[OWNER.md](OWNER.md).

**Nightly backups.** Supabase's Free plan keeps no backup you can download.
`.github/workflows/backup.yml` dumps the database every night, encrypts it with [age](https://age-encryption.org)
to the owner's public key and uploads it to a private Cloudflare R2 bucket, keeping 35 days; it runs
in this repository's GitHub Actions once it has a key, a bucket and the database's address, and is
skipped until then. Setting it up, what a backup holds and how to restore one into a new project:
[OPERATIONS.md, Backups](OPERATIONS.md#backups).

**Releases.** The instance ships through versioned releases (`.github/workflows/release.yml`,
[OPERATIONS.md, Releases](OPERATIONS.md#releases)): Pages builds a `production` branch the workflow
moves, and the workflow pushes the migrations and the functions. The steps above (`supabase db push`,
`supabase functions deploy`) are what it does, by hand for a first setup or when the workflow cannot
run; the app's version and What's new come from the `version.txt` and `CHANGELOG.md` it is built with.

**Android app (Play Store)** as a Trusted Web Activity is planned, not part of the repository yet.

## Every setting

Everything the instance is configured with, in one place. The owner-only parts (Regal, the error log)
are off until set.

| Where | Setting | Default | What it is |
| --- | --- | --- | --- |
| Web build env | `NUXT_PUBLIC_SUPABASE_URL` | none (required) | The Supabase project's URL. |
| Web build env | `NUXT_PUBLIC_SUPABASE_ANON_KEY` | none (required) | Its anon (publishable) key. Public. |
| Web build env | `NODE_VERSION` (Pages) | Pages' default | `24`. |
| Web build env | `NUXT_PUBLIC_LINK_TEMPLATES` | empty | Book links for every member, JSON (above). Public. |
| Web build env | `LIBELLUS_REGAL` | unset (off) | `1` builds with the owner's Regal layer. Owner only. |
| Web build env | `GIGET_AUTH` or `REGAL_LAYER` | unset | Where Regal comes from: a GitHub token that can read fabkho/regal, or a local checkout. Owner only. |
| Web build env | `NUXT_PUBLIC_REGAL_LIBRARY_SRC` | empty | The published library file Regal shows. Required with `LIBELLUS_REGAL=1`. Owner only. |
| Web build env | `NUXT_PUBLIC_SHELF_OWNER_ID` | empty (nobody) | The auth user id of the instance's owner: sees the Errors row and page, and Your shelf with Regal ([OPERATIONS.md, The owner](OPERATIONS.md#the-owner)). Owner only. |
| Supabase Auth | Site URL, Redirect URLs | `http://127.0.0.1:3020` locally | The instance's address (step 1.3, 4). |
| Supabase Auth | Confirm email, Email OTP length | on, 6 | As in `supabase/config.toml` (step 1.3). |
| Supabase Auth | User sign-ups | on | Leave on; invite codes gate sign-up in the database. |
| Supabase Auth | Email templates | Supabase's | Magic Link and Confirm signup, the designed mail in `supabase/templates/magic_link.html` (step 1.3; re-paste it when it changes). |
| Supabase Auth | SMTP host, port, user, password, sender address and name | Supabase's (team only) | The mail provider (step 2). |
| Invite codes | `scripts/create-invite-code.sh` | none | Uses, expiry, label, the code itself (step 5). Locally `LIBELLUS-DEV` is seeded. |
| Function secrets | `LIBELLUS_SITE_URL` | unset | `goodreads-rating`: the instance's address, named in its User-Agent; `waitlist-invite`: the sign-up link in the invite mail. Optional. |
| Function secrets | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME` | unset (no mail: Invite shows the code only) | `waitlist-invite`: the SMTP server that mails waitlist invites. Port 465 or the provider's alternative; 25 and 587 are blocked on hosted Supabase. `SMTP_FROM_NAME` optional. |
| Function secrets | `REGAL_EXPORT_TOKEN`, `REGAL_OWNER_EMAIL`, `REGAL_OWNER_NAME`, `REGAL_*` | unset | `regal-export`, owner only ([OWNER.md](OWNER.md)). |
| Database | `private.instance_owner.owner_id` | empty (nobody) | Who may read the client error log through `owner_client_errors` ([OPERATIONS.md, The owner](OPERATIONS.md#the-owner)). Set once by SQL. |
| Database | `private.shelf_publish.owner_id`, Vault `github_dispatch_token` | empty | The shelf's publish trigger, owner only; does nothing while empty. |
| Pages project | Custom domain, Web Analytics | none, off | Step 4; Optional pieces. |
| GitHub Actions secrets | `SUPABASE_DB_URL`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` | unset | Nightly backups: the session pooler's connection string, an R2 token for the bucket. Optional ([OPERATIONS.md](OPERATIONS.md#backups)). |
| GitHub Actions variables | `BACKUP_AGE_RECIPIENT`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_R2_BUCKET`, `BACKUP_MIN_BYTES` | unset (backup skipped), `libellus-backups`, `50000` | Nightly backups: the owner's age public key, where the bucket is. |
| Restore script | `LIBELLUS_PRODUCTION_REF` | the instance's project ref | The project `scripts/restore-backup.sh` refuses without `--i-know`: set it to the new ref after the project is replaced. |
| Source | App name, icons, colours | Libellus, "Night Reader" | Not settings: `web/nuxt.config.ts` (`pwa.manifest`), `web/i18n/locales/en.json` (`app.name`), `design/tokens.json`, `design/icons/`. |

`web/.env.example` lists the web build's variables for local work.

## Updating

Pull the new commits. Releases do the rest ([OPERATIONS.md, Releases](OPERATIONS.md#releases)); by hand,
in this order:

1. `supabase db push`: new migrations first. They only ever add (new tables, columns, functions)
   or change functions, so the running app keeps working with the new schema.
2. `supabase functions deploy goodreads-rating`, when `supabase/functions/goodreads-rating/` changed;
   `supabase functions deploy reading-page-og` for `supabase/functions/reading-page-og/`.
3. Push to the production branch: Pages builds and deploys the app. Installed apps pick up the new
   version on their next start (the service worker updates itself).

`git log --stat -- supabase/` shows what changed on the database side.

## What was verified

Checked for this page: the migrations apply in order onto an empty database (CI does it on every
pull request with a fresh `supabase start`, and the pgTAP, Vitest and Playwright suites run against
the result); the web app builds with `pnpm generate` without any private dependency (no Regal, no
`GIGET_AUTH`; a CI job on every pull request); the auth values (code length, confirmation, templates) are
the ones in `supabase/config.toml`, which the local stack and its tests use; the Pages build
settings are the owner's live ones (docs/HOSTING.md).

Not verified end to end: a brand-new hosted Supabase project (the dashboard's labels move now and
then), SMTP delivery through a particular provider, the custom-domain flow, and a fresh Pages
project. If a step reads differently in a dashboard today, correct it here.
