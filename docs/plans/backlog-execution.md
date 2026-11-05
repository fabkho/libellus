# Backlog execution plan: 27 items, 27 work packages (revision 4: refreshed against release 1.30.0)

**DRAFT, not merged, DO NOT MERGE.** One GitHub issue was created from this plan:
[#331](https://github.com/fabkho/libellus/issues/331), the postponed open sign-up bundle. Nothing else becomes an issue
until the owner says so.

This file is a plan, not a spec. It checks the owner's backlog of 27 items, grouped by Gemini (a grouping this plan
does not use), against the code. Revisions 1–3 read `2b3faf91` (release 1.14.0, 2026-10-11). **Revision 4 reads
`origin/main` at `65998068` (release 1.30.0, 2026-11-01).** The work packages each take one worker and one PR. Issue
drafts for the packages still open are in [`backlog-issues/`](backlog-issues/).

How revision 4 checked: `CHANGELOG.md` 1.17.0 → 1.30.0 (55 entries), `docs/parity.md`, the migrations up to
`20261112010000_hardcover_covers.sql`, the code, Regal's `origin/main` (`25da719`), `gh issue list --state open`, the
open PRs and the worktrees on this machine. Nothing was run. Item numbers **#1–#27** are the owner's (see the
[appendix](#appendix-the-backlog-as-received)). Sections 2–7 below keep revision 1–3 text where it is still true;
**the tables in this section and §8 overrule them**.

**Revisions:**
- 1: the audit and the 23 packages.
- 2: an expected public launch added WP-24–27.
- 3 (2026-10-12): open sign-up postponed, bundled in #331.
- 4 (2026-11-01): refreshed against 1.30.0. Ten packages have shipped, open GitHub issues are folded in, and the
  next 8 are ranked.
- How the branch was brought up to date: `origin/main`'s history was rewritten. The old base `2b3faf91` is no longer
  an ancestor, and main now has 13 commits. So `plan/backlog-execution` was **rebased** onto `origin/main` by
  replaying only this plan's three commits; the old history was dropped from the rebase todo. The push uses
  `--force-with-lease`.

## Shipped since the plan (audited against the code)

| WP | What | Release (PR) | Notes against the plan |
|---|---|---|---|
| WP-01 | Member's "Authors" title, no in-review pill, stronger month rules (#1, #11a, #24) | 1.15.0 (#309) | as planned |
| WP-03 | Tap your name to edit it (#3) | 1.15.0 (#310) | as planned |
| WP-04 | Compact feed rows (#18) | 1.15.0 (#314), 1.15.1 (#318: 24 px targets) | Shipped with 24 px targets; the plan said 44 px. |
| WP-05 | One paginated books sheet (#17) | 1.16.0 (#322) | as planned |
| WP-06 | Tap an author, a genre, "not rated yet" (#12, #16, #15, #14 part 1) | 1.19.0 (#335; test id fix #340) | as planned |
| WP-07 | Rate from the unrated sheet (#14 part 2) | 1.20.0 (#346) | `components/profile/RateRow.vue` |
| WP-08 | Chart by month or by week, with a navigator (#11b, #11c) | prototype 1.26.0 (#345), 1.27.0 (#414), 1.28.0 (#442) | Shipped as an animated capsule (`Chart.vue`, `ChartNav.vue`). Unlike the plan, the capsule also stays under All, and the arrows walk All and the years. |
| WP-09 | Every five-star book of the year (#25) | 1.16.0 (#321) | as planned |
| WP-10 | Collection page: + from search, and sorting (#10, #9) | 1.15.0 (#313) | as planned |
| WP-22 | Social links (#5) | 1.19.0 (#339) | Shipped as `profile_links` and `profile_link_settings` (migration `20261028010000_profile_links.sql`), not `member_links`. Five platforms: Instagram, TikTok, YouTube, Goodreads and **Reado**. StoryGraph, Hardcover and Fable were left out. Visibility defaults to followers, 10 calls an hour, and `owner_clear_profile_links` is ready for WP-25. |
| WP-02 | iOS shelf scrolling (#26) | **partly:** regal#84 (`22276c9`, 12 Oct) | The row now scrolls natively under a finger and is in every build since 1.17.0 (Regal is unpinned, built from its default branch). The Stack kept its own drag. **No record that the owner checked the Stack on an iPhone.** That check is still open, and so is pinning Regal. |

Shipped outside the 27 items (they change the plan's map):
- The import as a server job (1.24.0, #379–#387), its Web Push (1.25.0, #398) and the Hardcover zip import
  (1.29.0, #450, #454, #455).
- The "You both read" slideshow (1.26.0, #412, Regal reel).
- Own covers (1.27.0, #431–#437, off by default).
- The app update sheet (1.22.0, #354), Sentry (1.28.0, #440) and the new logo and launch takeover (1.30.0, #456,
  #459).
- Sheets, confirms and Back from the UI base (1.24.0, #375).

**Where the plan contradicted the code (fixed or noted in revision 4):**
1. **UI components moved into a package.** `web/app/components/ui/` now holds only `BookLine`, `LitCard`,
   `RatingInput`, `SearchPrompt` and `Stars`. `Sheet`, `Row`, `SeeAll`, `Segmented` and the rest come from
   `@fabkho/ui` (`github:fabkho/ui#v0.10.6`, `web/package.json:44`). Every `components/ui/Sheet.vue`-style path
   below is historical: changes to those parts go to the `fabkho/ui` repo, or wrap them in the app.
2. **WP-17's list of SQL functions is stale.** `import_books` was redefined in
   `20261111010000_import_zip_job.sql`; the read path (`member_reading_record`, `work_card`, `author_page`,
   `series_works`) in `20261109010000_cover_read_path.sql`; and the import's write phase moved to the server job
   (`20261104010000_import_job_write.sql`, `supabase/functions/import-job`). WP-17 must re-audit before it starts.
3. **WP-19's importer list grew.** There are now Reado (`data/import/reado.ts`), the Hardcover zip
   (`data/import/hardcoverZip.ts`) and the reading-tracker format (`data/import/readingTracker.ts`). The Hardcover
   zip already reads Paused: status 4 → Currently Reading plus a `paused` problem note, and it keeps `pausedOn`
   (`hardcoverZip.ts:286, 573, 650-652`). That is a ready hook for WP-19.
4. **WP-22's platform list:** see the table. The plan's StoryGraph, Hardcover and Fable entries are a follow-up only
   if members ask.
5. **The "running elsewhere" notes in revision 3 are stale.** The import cover work and the sign-in/shelf-retry work
   have merged (1.18.0 #332, 1.21–1.29). `data/import*`, `data/auth.ts` and `stores/shelf.ts` belong to nobody now.
6. **#22 (filter spinner) and #27 (high-resolution covers)** stay as decided in revision 1. #27 is now covered
   several times over by the cover pipeline (1.21.1–1.29.0).

## Next 8 (ranked) and what not to start

Quota rule: Claude Max 5x, **one Opus worker at a time**. "Normal" means DeepSeek V4.1 Flash on GOAT at high, or
Sonnet at high when asked.

| # | WP | What | Size | Model | Depends on | Hotspot / collision note | Token cost |
|---|---|---|---|---|---|---|---|
| 1 | WP-02 check | The owner swipes the Profile row and the `/profile/shelf` Stack on an iPhone (Safari and the home-screen app). A worker follows only if the Stack still fails: Stack pointer handling in Regal, then pin Regal in `web/regal.config.ts`. | S (check) / M (fix) | none / **Opus** if a fix is needed | the owner's phone | Regal repo; Libellus only `regal.config.ts` | 0 / M |
| 2 | WP-15 | Grid or list in the Library, with each status's date line (#20, #21) | L | normal | none | `pages/library.vue`, `components/library/*`, `data/libraryView.ts`; free | L |
| 3 | WP-13 | Refactor: the reorder list out of `EntryList.vue` (461 lines) | M | normal | none | `components/collections/EntryList.vue`; free | M |
| 4 | WP-14 | Collections in her own order next to "last edited" (#7) | L | normal | WP-13 | collections store, data and pages; new `reorder_collections` and a `sync_write` action (`sync_write` chain head) | L |
| 5 | WP-17 | On Hold, database: a paused open session (#23) | L | **Opus** (the one Opus slot) | WP-14 (`sync_write`); a re-audit of the functions (contradiction 2) | all status-aware SQL; the server import job (`import-job`); staging (#177) would de-risk the enum migration | L |
| 6 | WP-18 | On Hold, app (#23) | L | normal (Opus review) | WP-17, WP-15 (library files) | library, book page, Home, queue, stats; touches `data/memberShelf.ts` | L |
| 7 | WP-29 (new) | Export your data: BetterReads JSON and Goodreads CSV (#170) | M | normal | none | new route and `data/export/*` (shares a folder with the Regal export); include `profile_links` | M |
| 8 | WP-20 | Pages read across books: week, month, custom range (#13) | L | normal | none (WP-08 shipped) | `data/stats.ts`, `stores/stats.ts`, `pages/profile/index.vue`; reuses `Chart.vue`/`ChartNav.vue` | L |

**Not now, and why:**
- **WP-11 and WP-12 (visible Collections):** a privacy model no invited member has asked for, and WP-11 wants the
  Opus slot that WP-17 has.
- **WP-16 (bio):** free text; it waits for WP-26, which is postponed.
- **WP-19 (On Hold importers):** after WP-18. Small, and the Hardcover zip hook is ready.
- **WP-21 (Collection covers):** parked. Own covers (#431–#437) would carry the storage if it is ever un-parked.
- **WP-23 (counts):** parked. The self-only variant is S if the owner wants it.
- **WP-24–27 (#331):** postponed by the owner.
- **WP-28 (genres and tags, #344 and #358):** waits for the owner's answers to PR #357 §7. Its first PR is the
  natural number 9.
- Issues that are **not** next (each mapped in §1.1):
  - #305 Google Books (needs a key, and the owner excluded Google for covers);
  - #361 Goodreads in search (terms);
  - #213 affiliate links;
  - #259 next-book picker;
  - #172 year wrapped;
  - #95 native iOS;
  - #90/#102 Play Store;
  - #142 CSP reports;
  - #177 staging;
  - #449 declarative schemas (December).

## Now vs before open sign-up

- **Safe while invite-only; revisit before open sign-up** (they show member-written content to others):
  - WP-12 (visible Collections);
  - WP-16 (bio);
  - WP-21 (Collection covers);
  - **WP-22 (social links, shipped):** before sign-up opens it needs the "links" report reason, and its owner action
    already exists.
- **Postponed with open sign-up (#331):** WP-24, WP-25, WP-27 and WP-26 (name and text rules). Revision 3 kept
  WP-26 as a free-standing P3; the owner's instruction for revision 4 is to treat it as postponed with #331.

**Collisions today** (open PRs and worktrees on 2026-11-01):
- **PR #457** `feat/way-in-lamp`: `web/app/components/auth/{Frame,Mark}.vue`, `design/tokens.json`,
  `docs/DESIGN.md`, `docs/MOTION.md`, `web/e2e/auth.spec.ts`. No package above touches these.
- **Worktree `boot-screen-revert`** (`fix/boot-screen-android-logo`): `web/app/assets/css/main.css`,
  `web/nuxt.config.ts`, `web/app/plugins/launch-takeover.client.ts`, `web/public/*` icons.
  - It collides with WP-02 only if the Stack fix needs `main.css`.
- **Worktree `libellus-friends-visibility`** (no commits yet). Its name points at friends and privacy.
  - It would collide with WP-11/12 and with anything in `pages/friends/*`, `components/friends/PrivacySheet.vue`
    or the social migrations.
  - Ask the coordinator what it holds before dispatching WP-11 or WP-12.
- **Draft plans** #357 (genres) and #333 (buddy read): docs only.
- **Free now** (no open work): `data/import*` and `supabase/functions/import-job`, `data/auth.ts`, `stores/shelf.ts`,
  stats and profile, collections, library.

---

## 1. Summary table

Tiers: **P0** bugs · **P1** easy wins · **P2** medium · **P3** hard · **P4** refactor, long-term or parked ·
**postponed** = waits for the owner to open sign-up (#331).
"Wave" counts from today (revision 4); shipped packages show their release.

| ID | Title | Items | Tier | Size | Model | Depends on | Wave |
|---|---|---|---|---|---|---|---|
| WP-01 | Profile quick fixes | #1, #11a, #24 | n/a | S | n/a | n/a | **shipped 1.15.0 (#309)** |
| WP-02 | iOS: the shelf's row and Stack (Regal) | #26 | P0 | S check / M fix | none / Opus | the owner's phone | **row shipped (regal#84); Stack check: 1** |
| WP-03 | Tap your name to edit it | #3 | n/a | S | n/a | n/a | **shipped 1.15.0 (#310)** |
| WP-04 | Compact feed rows | #18 | n/a | S–M | n/a | n/a | **shipped 1.15.0 (#314, #318)** |
| WP-05 | One paginated books sheet | #17 | n/a | M | n/a | n/a | **shipped 1.16.0 (#322)** |
| WP-06 | Tappable stats | #12, #16, #15, #14 | n/a | M | n/a | n/a | **shipped 1.19.0 (#335)** |
| WP-07 | Rate from the unrated sheet | #14 | n/a | M | n/a | n/a | **shipped 1.20.0 (#346)** |
| WP-08 | Chart by month or week, with a navigator | #11b, #11c | n/a | M | n/a | n/a | **shipped 1.27.0 (#414), 1.28.0 (#442)** |
| WP-09 | Every five-star book of the year | #25 | n/a | M | n/a | n/a | **shipped 1.16.0 (#321)** |
| WP-10 | Collection page: + add, sorting | #10, #9 | n/a | M | n/a | n/a | **shipped 1.15.0 (#313)** |
| WP-11 | Collection visibility, database (private by default, opt-in) | #6, #2 | P3 | L | Opus | not with WP-17 (one Opus slot); check the `libellus-friends-visibility` worktree | 4+ |
| WP-12 | Collection visibility, app (**safe while invite-only; revisit before open sign-up**) | #6, #2 | P3 | M–L | normal | WP-11, WP-14 | 5+ |
| WP-13 | Refactor: a reusable reorder list | enabler for #7 | P2 (enabler) | M | normal | none | 1 |
| WP-14 | Manual order of Collections next to "last edited" | #7 | P2 | L | normal | WP-13 | 2 |
| WP-15 | Grid or list in the Library, with each status's date line | #20, #21 | P2 | L | normal | none | 1 |
| WP-16 | A short bio (**safe while invite-only; revisit before open sign-up**) | #4 | P3 | M | normal | WP-26 (postponed) | after #331 opens, or with its own minimal rule if the owner wants it sooner |
| WP-17 | On Hold, database | #23 | P2 | L | Opus | WP-14 (`sync_write`); re-audit (contradiction 2) | 3 |
| WP-18 | On Hold, app | #23 | P2 | L | normal (Opus review) | WP-17, WP-15 | 4 |
| WP-19 | On Hold, importers (Goodreads, Hardcover CSV and zip, Fable, Reado, reading tracker) | #23 | P3 | S–M | Haiku / normal | WP-18 | 5 |
| WP-20 | Pages read across books | #13 | P3 | L | normal | none | 1–2 |
| WP-21 | A Collection's own cover (**parked; revisit before open sign-up**) | #8 | P4 | L | normal | WP-12, WP-14, WP-25; could reuse own covers (#431–#437) | parked |
| WP-22 | Social links | #5 | n/a | M | n/a | n/a | **shipped 1.19.0 (#339)**; the "links" report reason comes with WP-25 (#331) |
| WP-23 | Follower counts (a self-only variant possible) | #19 | P4 | S / M | Haiku / normal | none | parked |
| WP-24 | Open sign-up safely (`signup_mode` switch, default `invite`) | open sign-up | **postponed (#331)** | M | Opus | the owner opens #331 | postponed |
| WP-25 | Report a member and the owner's minimal handling | open sign-up | **postponed (#331)** | M | normal (Opus review of the SQL) | the owner opens #331 | postponed |
| WP-26 | Name rules and a shared text rule | #3 guard; #4, #2, #5 prerequisite | **postponed (#331)** | M | normal (Opus review) | the owner opens #331 | postponed |
| WP-27 | Launch texts: privacy notice, community rules, runbook | open sign-up | **postponed (#331)** | S–M | normal (the owner reviews) | the owner opens #331 | postponed |
| **WP-28** (new) | Genres and tags (per `docs/plans/genres.md`, PR #357: 8 PRs) | #344, #358 | P2 | L (multi-PR) | normal; Opus for the label resolver design | the owner's answers to #357 §7 | after the answers |
| **WP-29** (new) | Export your data: BetterReads JSON and Goodreads CSV | #170 | P2 | M | normal | none | 1–2 |

**Counts:**
- Shipped: 10 (WP-01, 03–10, 22), and WP-02 in part.
- Open: WP-02 (the Stack check) and WP-11–WP-20 (10 packages), plus the new WP-28 and WP-29; WP-30 and WP-31 are proposed for later.
- Parked: WP-21, WP-23.
- Postponed with #331: WP-24–27.

### 1.1 Open GitHub issues that were not in the plan

| Issue | Verdict |
|---|---|
| #331 Open sign-up (postponed) | WP-24, WP-25, WP-26, WP-27 (already the plan's). |
| #344 Raw genre labels; #358 Tags spec | **New WP-28** "Genres and tags", built from `docs/plans/genres.md` (draft PR #357: data model, resolver, 8-PR plan, 16 open questions). It starts after the owner answers #357 §7. Its chart parts touch `components/profile/Genres.vue` and `data/stats.ts` (shared with WP-20). |
| #170 Export your data | **New WP-29** (M, normal): a JSON of everything she owns (Library, reads, reviews, Collections, profile links, settings) and a Goodreads-format CSV. It covers the GDPR export noted under WP-22. It does not need #172. |
| #172 Year wrapped (shareable image) | **Proposed WP-30**, later (spec label). It builds on the year in review and the five-star row (WP-09), and on the reel/still from the slideshow (#412) for the image. Not in the next 8. |
| #259 Next-book picker | **Proposed WP-31**, later. Regal now has a pick context (regal#86, #87), and prototype #268 explored the deals. It needs an owner design pick first. |
| #305 Google Books | **Not a backlog item yet.** It needs an API key and the owner's terms decision; the cover study excluded Google (`docs/plans/cover-sources.md`). It would touch `data/import*`, search and the edition picker. If approved, a WP of its own after WP-28 (genres are one of its reasons). |
| #361 Goodreads in search | **Not a backlog item yet** ("later", Goodreads terms). If approved, a search-only WP. |
| #213 Affiliate links | **Not a backlog item** (business and legal decision; "later"). |
| #177 Staging | **Ops, not a WP.** Recommended before WP-17's enum migration (a second Supabase project to try it on). |
| #142 CSP reports | **Ops / security, not a WP.** Sentry (1.28.0) can take CSP reports through its `report-uri`, which may be simpler than the client error log the issue proposes. |
| #449 Declarative schemas | **Tooling, not a WP.** Revisit in December, as the issue says; it would change how WP-11, 14, 17 and 26 write migrations. |
| #90 / #102 Play Store TWA | **Distribution, not a backlog WP.** PR #102 is the owner's. |
| #95 Native iOS | **Not now** ("later"). |

---

## 2. Open sign-up: what changes (postponed, issue #331)

**Status (revision 3):** the owner postponed open sign-up on 2026-10-12, and the app stays invite-code only. This
section is kept as the fact base for issue [#331](https://github.com/fabkho/libellus/issues/331). It lists, from the
code, everything that relies on invite-only today and must change **before** sign-up opens. None of it is work for
now.

### 2.1 What is invite-only today

- **The sign-up gate is in the database.**
  - `public.signup_invite(p_meta, p_lock)` raises `invite_code_required`, `invite_code_invalid`, `_expired` or
    `_exhausted` (`supabase/migrations/20261002190000_invites_and_accounts.sql`, about lines 75–105).
  - The triggers on `auth.users` judge the invite twice: on insert, which rolls a refused sign-up back, and on
    confirmation, which uses up the code.
  - `invite_code_status(p_code)` is the form's pre-flight.
  - The client sends `data: { invite_code }` with `signInWithOtp({ shouldCreateUser: true })` (`web/app/data/auth.ts:167-178`).
  - Sign-in for an unknown address uses `shouldCreateUser: false` (`:141-146`), so no mail goes to an address that is
    not a member.
- **Consequence of opening it:** today, a sign-up without a valid code never sends a mail. Once the gate is off,
  **anyone can make the app send a code to any address.**
  - That costs email quota and sender reputation, and enables email bombing.
  - No captcha is configured: `[auth.captcha]` is commented out in `supabase/config.toml:216-220`, and nothing in
    `web/app` mentions one.
- **The waitlist exists only because of invites:**
  - the reading page's form (`components/reading/Waitlist.vue`);
  - `join_waitlist` for `anon` (5 an hour per address, 100 in all; `docs/OPERATIONS.md` → Waitlist);
  - the owner's Waitlist page (`pages/profile/waitlist.vue`);
  - the `waitlist-invite` edge function.
  - When sign-up opens, the form becomes a "Sign up" link, and the waitlist is retired or kept only for the addresses
    already on it.
- **The texts say invite-only:**
  - the privacy notice's lead: "run as an invite-only beta" (`web/app/legal/privacy.ts:13`);
  - the account data includes "the invite code you signed up with" (`:32`);
  - the waitlist (`:37`, `:55`, `:111`);
  - `SPEC.md:17,41` ("Invite-only accounts").

### 2.2 What protects members today, and what is missing

| Area | Today (evidence) | Gap before open sign-up |
|---|---|---|
| **Report** | **None.** No report flow for profiles, names, photos, reviews or anything else. The only channel is the member's Contact sheet: `public.feedback`, kinds `bug \| feature \| other`, 10–2,000 characters, 5 an hour and 20 a day (`20261024010000_feedback.sql:4,29-30`), read by the owner at `/profile/feedback`. | A public service hosting member content needs a notice-and-action path (the EU Digital Services Act, Art. 16, applies to every hosting service; the owner should confirm the scope against `docs/legal-checklist.md`). **WP-25**, a precondition of open sign-up (#331). |
| **Block, private accounts** | `block()` and `unblock()` (`20261017020000_social_follows.sql`). Accounts are **private by default** (`social_settings.private boolean not null default true`, `20261017010000_social_settings.sql:62`). Sections `show_*` default true, but on a private account only accepted followers see them. | Enough for one member protecting herself. Not a way to tell the owner. |
| **Discoverability** | **No search by name, no directory, no suggestions**: a deliberate decision, "they show who is a member" (`docs/proposals/social-v1.md:273`). A profile opens only through her follow link (`/f/<token>`, 128 random bits) or an existing follow or request (`private.reachable`). The book page's readers list only members she follows. The public reading page and shared book cards (`/r/<token>`) are open to anyone holding the link. | Strangers cannot browse profiles. They reach a member only through a link she shared. A **public account's** link posted publicly lets anyone follow at once and see every section she leaves on. Keep it that way: no name search in this backlog. |
| **Display names (#3)** | Free text in `user_metadata.name`, written by GoTrue (`session.setName` → `auth.updateUser`). The client trims it and caps it at 40 (`cleanName`, `data/auth.ts:58-61`). The server only does `left(btrim(name), 40)` when reading (`private.member_name`, `20261017010000_social_settings.sql:258-265`). Not unique. | **Impersonation:** anyone can call herself the app's name, "Support" or the owner's name, and use bidi, zero-width or control characters or a URL. The UI is not a guard, because the auth API is public. **WP-26**. |
| **Photos** | Private bucket `avatars`, 256 KB, webp/jpeg, path pinned to `<uid>/<32 hex>(-128).(webp\|jpg)` (`20261009120000_avatars.sql:46-63`), shown to members who are `reachable`. **No cap on the number of files per member**: the insert policy accepts any new 32-hex name. | Storage abuse on the Free plan (1 GB of files); offensive images with no report path. A per-member file cap in WP-24 and "photo" as a report reason in WP-25. Photos are re-encoded on the device (`utils/avatarRaster.ts`), which drops EXIF. |
| **Reviews (feed, profile, reading page)** | Up to 10,000 characters (`reading_sessions_review_present`, `20261003102707_reading_sessions.sql:69`). Followers see them in the feed and on her profile; a shared review or reading page is visible to anyone with the link. | User content strangers can see once accounts are public or links travel. Covered by WP-25 (report the member, with "a review" as the reason). Reporting a single review lands after WP-04, which changes `FeedRow.vue`. |
| **Collection names** | 1–80 characters, private today (`collections_name_present`, `20261003110515_collections.sql:29`). | Content others can see only once WP-12 lets her make one visible. Safe while invite-only; before sign-up opens, WP-12 needs WP-25 and WP-26. |
| **Follows at scale** | Per follower: 30 follow calls an hour, 150 follows, 20 pending requests (`20261017020000_social_follows.sql`, about lines 114–121). Likes: 300 an hour (`20261025010000_social_v2a.sql:1170`). | There is no limit on how many requests a member *receives*, and no "decline all". Watch, not build: requests only come from people who hold her link. |
| **Feed (#18)** | Only from members she follows, after a 10-minute settle window (social v1). | Strangers in her feed only if she follows them. Compact rows (WP-04) help more once members follow more people; no safety change. |
| **Rate limits** | Follows, likes, feedback, waitlist and the client-error log have limits (above, `docs/OPERATIONS.md` → Client errors). **None** on Library writes, Collections, reviews, photo files or sign-up attempts beyond GoTrue's own (`supabase/config.toml` `[auth.rate_limit]`: `sign_in_sign_ups = 30` and `email_sent = 2` locally; the hosted values are in the dashboard). | Email and photos are capped in WP-24. Other per-member write caps can wait: watch the database size first. |
| **Email (Resend)** | The notice names Resend for sign-in codes, invites and notification emails (`privacy.ts:71`). Sign-in is a six-digit code with **no password**, so **every sign-in is an email**, not only every sign-up. Supabase Auth sends through the owner's SMTP (`docs/SETUP.md`, step 2). **The project's limit is 30 mails an hour** (owner, 2026-10-12). | Before sign-up opens (WP-24, #331): raise the limit or the plan. At 30 an hour, a burst of new members, or someone abusing the sign-up form, keeps everyone else from signing in for the rest of the hour. |
| **Supabase plan** | The **Free plan** (`docs/OPERATIONS.md:354`, `docs/SETUP.md:234`). Covers are linked, not stored (`docs/covers.md`). Realtime is not used (`web/app/data/realtimeStub.ts`). | The Free plan's database, file storage, egress and monthly-active-user quotas, as published by Supabase (verify on the dashboard). Photos are the only stored files today; Collection covers (#8) would add more, which is one more reason WP-21 is parked. A usage alert and an upgrade point belong in WP-27's runbook. |
| **Minors** | The notice says "not for under 16" and the account is deleted when known (`privacy.ts:138`, DE `:277`); `docs/legal-checklist.md:64` calls 16 "a choice". The sign-up asks nothing. | One line at sign-up, "I am 16 or older" (WP-24), with the copy in WP-27. No age verification. |
| **GDPR** | The notice lists name, photo, reading data, Friends, reading page, waitlist and logs (`privacy.ts:30-40`). | Reports (who reported whom, why, what was done) are a new data category (WP-27). Bio (#4), links (#5) and covers (#8) each add one when they land (in WP-16, WP-22, WP-21). |
| **German** | Every screen is bilingual; parity is enforced by `tests/i18n-parity.test.ts`. | New strings: report reasons and confirmations, the age line, name-rule errors, community rules, the sign-up without a code. All in EN and DE, per `docs/i18n/german-glossary.md`. |
| **Cost** | The Free plan; Resend; Cloudflare Pages. | Resend and Supabase are the two meters that move with sign-ins. WP-27's runbook names the thresholds. |

### 2.3 What this does to the backlog

| Item | Revision 1 | Revision 2 (launch expected) → **revision 3 (postponed, invite-only)** |
|---|---|---|
| #3 inline name edit (WP-03) | P1 | **Unchanged and safe:** a shortcut to the existing sheet. WP-26 adds server-side name rules for every path. |
| #4 bio (WP-16) | P3, after WP-11 and WP-12 | P3. **Revision 3:** safe while invite-only; revisit before open sign-up. It takes WP-26's text rule (length, no URLs, no control characters) and needs a "bio" report reason (WP-25) before sign-up opens. |
| #5 social links (WP-22) | Parked, partly "little value in an invite-only app" | **Owner decision: wanted. P2.** Built only in the safe shape: allow-listed platforms, a validated handle or ID per platform (no free URLs), the app builds the URL, `rel="noopener noreferrer nofollow ugc"` with an external-link mark, a visibility setting (default *followers only*), the privacy notice. **Revision 3:** it can start now; it adds no free text. The "links" report reason comes with WP-25 before sign-up opens. |
| #2 / #6 visible Collections (WP-11, WP-12) | P3 | **P3**. The model stays **private by default, opt-in per Collection**. **Revision 3:** safe while invite-only; revisit before open sign-up (WP-26's text rule for the name now, a "Collection" report reason with WP-25). |
| #8 Collection cover upload (WP-21) | P3, last | **P4, parked unless members ask.** Uploaded images strangers can see, with no automated moderation, on a 1 GB Free plan. If kept: 256 KB, webp/jpeg only, re-encoded on the device (drops EXIF), path pinned per member, one file per Collection plus a per-member cap, "cover" as a report reason, and the owner can remove it. |
| #19 counts (WP-23) | Parked | **Still parked for public counts**. They leak the size of a private member's circle, invite comparison and are inflated by bots. **New:** a self-only variant (her own Following, Followers and Requests counts on People, never shown to others) is S, leaks nothing, and can be done any time. |
| #18 feed (WP-04) | P1 | P1, more useful once members follow more people. |
| All stats and Collections polish | unchanged | unchanged. |

---

## 3. Verdicts at a glance

| Verdict | Items |
|---|---|
| **Already done, or mostly** | **#15**: star rows already open a sheet (`components/profile/Ratings.vue:30-46`, `pages/profile/index.vue:130-132`, parity "Tap a star row → a sheet"); only "N not yet" is missing. **#19**: follows, requests, private and public accounts, blocks and the follow link have all shipped (migrations `20261017010000`…`20261025010000`); only counts are missing, and they were left out on purpose. **#21**: list rows already show each status's date: Want "Added {date}" (`components/library/EntryRow.vue:74`), Finished the day it ended, DNF "DNF · {date}", Currently reading "Since {date} · day {n}" (`components/library/ReadingCard.vue:21`). **#27**: covers are already stored large (Apple 600×900, Open Library `-L`: `data/covers.ts:178-185`, asserted in `tests/covers.test.ts:149,153-154`). |
| **Premise wrong or partly wrong** | **#11a**: the chart itself never links to the Year in review; the link is the "{year} in review ›" pill beside the chart's title (`pages/profile/index.vue:174-176`). Under All, the year columns also go there (`:122-123`). **#12**: authors are plain rows with no tap at all (`components/profile/Authors.vue:24-31`); an author page (`/author/[key]`) also exists as an alternative target. **#9**: there is no publication *date*, only `books.published_year`. "Date added" means two things: to the Library (`addedAt`) or to the Collection (`collection_entries.added_at`, which the app does not read today). **#22**: there is nothing to wait for: filters are a synchronous `computed` over the device's copy (`pages/library.vue:79-80`). **#27**: the Goodreads CSV has no image column at all (`tests/fixtures/goodreads/library_export.csv:1`), so no `._SY75_` tokens exist to strip. **#6**: every Collection is already private (RLS `collections_own`, `20261003110515_collections.sql:96-100`); the real work is a visibility model, which #2 needs anyway. |
| **Recommended not to do (or parked)** | **#19** public counts: deliberately excluded by social v1 (`docs/proposals/social-v1.md:30,95`; `pages/friends/people.vue:8` "No counts anywhere"). They would leak the size of a private member's circle; a self-only variant is offered (WP-23). **#22** spinner: it would be fake latency (see above). **#8** cover upload: images strangers can see, with no automated moderation, on a Free plan; P4, parked unless members ask (WP-21). |
| **Owner decisions after revision 2** | **#5** social links: **wanted**. A real package (WP-22, P2, wave 3) in the safe shape, after the report flow (WP-25), the text rule (WP-26) and the launch texts (WP-27). |

---

## 4. Item by item

Each item covers four things: **exists?** · **premise** · **size, files, risk** · **depends on**. The tier
reason is on the last line.

### Profile and other members' profiles

**#1 "Authors you return to" on someone else's profile.**
- **Exists?** Yes, and it is a real bug. `ProfileAuthors` renders `t('profile.authors.title')` with no name or
  `foreign` prop (`components/profile/Authors.vue:17`). The member pages reuse it unchanged:
  `pages/friends/[member]/index.vue:326` and `pages/friends/[member]/[year].vue:138`.
- **Strings:** EN "Authors you return to", DE "Autoren, zu denen du zurückkehrst" (`web/i18n/locales/{en,de}.json:211`).
- **Other "you" leaks on member pages:** none found. `member.yearEyebrow` and `member.since` are already
  named. `genre.stats.row` ("…of your books", "…deiner Bücher") would leak, but the Genres block is not
  rendered on member pages today.
- **The fix:** an optional `name` prop selects `profile.authors.titleOf`: "Authors {name} returns to" /
  "Autoren, zu denen {name} zurückkehrt". Use a verb construction, not a possessive, because "{name}s" breaks on
  names ending in s, x or z. When the name is missing (`member.someone`), fall back to a neutral key ("Most-read
  authors" / "Meistgelesene Autoren"), never "Ein Mitglied" in the middle of the sentence.
- **Size:** S. No DB, no RLS.
- **Tier:** P0, a wrong label in front of every follower.

**#2 Her public Collections on her profile.**
- **Exists?** Not at all.
  - `collections` has `id, member_id, name, position, created_at` plus `updated_at`, and no visibility column
    (`20261003110515_collections.sql:23-35`, `20261026020000_collections_updated_at.sql`).
  - RLS is owner-only (`:96-100`). `20261017040000_social_readers.sql:32` lists her collections under "what
    never leaves".
  - `member_profile` (`20261025010000_social_v2a.sql:861`) returns none.
- **Premise:** correct.
- **Size:** L in total, and it needs the same model as #6. That gives two packages: WP-11 (database, Opus)
  and WP-12 (app).
- **Risk:**
  - Hidden-from-followers entries (`library_entries.hidden`) must never show through a Collection: filter
    them with `not e.hidden`, as `social_readers.sql:121,201` does.
  - The reads go through security-definer functions gated by `private.visible` (`20261017010000_social_settings.sql`),
    never by widening the table's RLS.
  - The privacy notice says Collections are private (`app/legal/privacy.ts:34`, DE about `:173`), so it changes
    in EN and DE.
- **Depends on:** #6.
- **Tier:** P3, a privacy model.

**#3 Tap the name to edit it (own profile).**
- **Exists?** Partly. The name is a plain `<h1>` (`components/profile/Hero.vue:57`). Editing works only from the
  Account's Name row (`components/profile/Account.vue:162`), which opens `ShellNameSheet` (`:225`); the name
  lives in `user_metadata.name` (`session.setName`, `data/auth.ts`).
- **Size:** S: hoist the sheet's open state or emit from the Hero, as `@photo` already is (`pages/profile/index.vue`
  around `:159`).
- **Risk:** a11y (a button inside the `h1`, an accessible name, a 44 px target, focus returning).
- **Tier:** P1, an easy win.

**#4 Bio or slogan.**
- **Exists?** Not at all.
  - `accounts` has `id, invite_code_id, created_at, avatar_path, avatar_updated_at`, and only select-own RLS
    (`20261002190000_invites_and_accounts.sql:39`, `20261009120000_avatars.sql:87`).
  - There is no report or flag mechanism, only block.
  - `delete_my_account` cascades from `auth.users`, so a column on `accounts` is covered.
- **Size:** M: a migration (`accounts.bio` with a length check, `set_bio`, returned by `member_profile`),
  `Hero.vue`, `MemberHero.vue` (between `:27` and `:28`), a sheet, and the privacy notice in EN and DE (the
  "name and photo" category, `privacy.ts:33`, DE `:172`, and the deletion lines).
- **Risk:**
  - Moderation: text that strangers can read on public accounts, with no report flow. It needs a hard length
    limit, plain-text rendering and no autolinking.
  - GDPR: a new data category.
- **Tier:** P3; worth doing with those limits. Worth more once sign-up opens, because strangers decide whether to
  follow from it. **Safe while invite-only; revisit before open sign-up:** it takes WP-26's shared text rule now,
  and needs a "bio" report reason (WP-25, #331) before sign-up opens.

**#5 Social and external profile links.**
- **Exists?** Not at all. `components/profile/LinksSheet.vue` and `link_templates` are a different feature: the
  member's own book-link templates, which never leave the database (`20261006090000_link_templates.sql`).
- **Size:** M.
- **Risk:** outbound links shown to strangers are a phishing and spam vector, with no report flow today
  (WP-25 adds one) and a new privacy category.
- **Verdict (owner decision):** **wanted, and built in a safe shape.** Public accounts, and later open sign-up (#331),
  bring both the value (readers bring audiences from Instagram and TikTok) and the incentive for throwaway accounts
  to plant links, so the shape is strict:
  - A validated *handle or canonical ID* per allow-listed platform. No free URLs: a member cannot point a link
    anywhere.
  - The app builds the URL, with `rel="noopener noreferrer nofollow ugc"` and an external-link mark.
  - A visibility setting.
  - "Links" as a report reason (with WP-25, before sign-up opens).
  - The privacy notice.
  - Revision 3: no hard dependency now (wave 1). Safe while invite-only; revisit before open sign-up. Full design in
    §7, WP-22.
- **Tier:** P2 (WP-22). Owner decision after revision 2: social links are wanted. The safe shape above is now the
  package; the platforms, formats and visibility are in §7, WP-22.

### Collections and visibility

**#6 Private Collections.**
- **Premise:** inverted. Every Collection is private today, so "mark one private" only means something once
  some can be seen.
- **The model (one for #2 and #6):** `collections.visibility` (`'private' | 'followers'`, default `'private'`),
  set per Collection by its owner. Followers read it through `member_collections(p_member)` and
  `member_collection(p_member, p_collection, …)` (security definer, `private.visible`, `not e.hidden`, blocks
  respected).
- **Tier:** P3 (WP-11, WP-12).

**#7 Drag Collections into her own order.**
- **Exists?** Partly. `collections.position` exists (index `collections_by_position`) but is only the creation
  order. The list is "last edited first" since PR #302 (`sortByEdited` in `data/collections.ts`, the held order in
  `utils/editedOrder.ts`). Parity says "There is no manual order of Collections" (`docs/parity.md:717`).
- **Drag code to reuse:** a Collection's *entries* already reorder with in-house pointer, keyboard and
  live-region code (`components/collections/EntryList.vue`, `lift` at `:68`, 454 lines).
- **Coexistence with #302:** a **sort mode**, `recent` (the default, today's behaviour) | `manual`. Manual order
  is `collections.position`, written by a new `reorder_collections(ids[])`, which must not touch `updated_at`.
  The mode decides the order on the Collections page, in the picker and in the Library row's fan. The held order
  (`useEditedOrder`) applies in `recent` only.
- **Size:** L, after a refactor that extracts the drag (WP-13).
- **Tier:** P3 (WP-14).

**#8 A Collection's own cover image.**
- **Exists?** Not at all. `components/collections/Mosaic.vue` draws the first four covers. The `avatars` bucket's
  policies are avatar-specific (path regex, 256 KB, select-own) and `delete_my_account` checks only that bucket
  (`20261009120000_avatars.sql`).
- **Size:** L: a new bucket and policies, `collections.cover_path`, purging on account and Collection deletion,
  crop and raster reuse (`utils/crop.ts`, `utils/avatarRaster.ts`).
- **Risk:** once Collections can be seen (#2), uploaded images reach followers. Once sign-up opens (#331), the
  uploaders are strangers too, there is no automated image moderation, and the Free plan holds 1 GB of files.
- **Tier (revision 2):** **P4, parked unless members ask** (WP-21).
- **If kept, it needs all of these:**
  - 256 KB, webp/jpeg only.
  - Re-encoded on the device like the photo (`utils/avatarRaster.ts`), which strips EXIF.
  - The path pinned to `<uid>/<collection>/…`.
  - One file per Collection, plus a per-member cap in the insert policy.
  - "Cover" as a report reason (WP-25), and an owner action to remove it.

**#9 Sort inside a Collection.**
- **Exists?** Not at all. Entries come in `position` order (`data/collections.ts:219`).
- **Premise:** partly wrong. There is no publication date, only `published_year`. "Date added" is ambiguous:
  `collection_entries.added_at` exists (`20261003110515_collections.sql`, `collection_entries` table) but the select
  does not read it.
- **Approach:** view-only sorts. "Your order" (drag on) stays the default; drag and grips are off while sorted.
  Reuse the Library's sort sheet (`components/library/SortSheet.vue`, `SortKey` in `data/libraryView.ts:21`), which
  needs a `sorts` prop because it is tied to `EntryStatus` today.
- **Size:** M.
- **Tier:** P2 (WP-10).

**#10 A + on the Collection page that opens search.**
- **Exists?** Partly. Only the empty state has a search prompt (`UiSearchPrompt`, `collection.search`), and it opens
  plain search. Adding to a Collection is only possible from the book page's picker. `add_to_collection` already
  takes a search snapshot (parity "Collection picker").
- **Approach:** a `target` mode in `stores/search.ts`, modelled on the existing `linking` mode.
- **Size:** M.
- **Tier:** P2, a cheap win that shares the page with #9 (WP-10).

### Analytics and statistics

**#11a Remove the Year-in-Review link at the chart.**
- The pill `UiSeeAll :to="/profile/${stats.year}"` sits beside "By month" (`pages/profile/index.vue:174-176`); the
  member page has the same pill (`pages/friends/[member]/index.vue:312-314`).
- After removal, the Year cards (`components/profile/YearCards.vue`) and, under All, the year columns still lead to
  a year.
- **Size:** S.
- **Tier:** P1, carried in WP-01 (same files).

**#11b/c Month or week toggle, and a navigator.**
- **Exists?** Not at all. There is no weekly bucketing anywhere in `data/stats.ts`; the only "week" is the Monday-first
  calendar in `components/profile/Days.vue`. The range is `stats.year` (the year pills).
- **Size:** M: `weeksOf(reads, …)` on `endedOn`, a toggle, ‹ › state in `stores/stats.ts` (so it survives a trip to a
  book), and a `week` sheet kind.
- **Open:** what the range of weeks is (52 columns do not fit `components/profile/Columns.vue`'s `flex-1` bars).
- **Tier:** P2 (WP-08).

**#12 An author's row opens a sheet of their books.**
- **Exists?** Not at all. Rows are `div role="listitem"` with no action (`components/profile/Authors.vue:24-31`).
- **Data:** `figures.authors[].books` exists. Authors are grouped by `authors[0]` (`data/stats.ts`), so a
  `readsByAuthor` selector is trivial.
- **Alternative target:** `/author/[key]`. The figure holds no key, though; one would come from
  `authors.ofBook(book.id)`, which may be missing offline. Recommendation: open the sheet, with an author-page
  link in its top slot when a key is known.
- **Size:** S on top of WP-05.
- **Tier:** P1 (WP-06).

**#13 Pages read across books, a chart with ranges.**
- **Exists?** Partly. "Reading days" (`components/profile/Days.vue`) is a five-week dot calendar.
  `reading_progress_days` holds per-day pages, but the stats record loads only 42 days (`DAYS_SHOWN`,
  `data/stats.ts:69`).
- **Size:** L: a lazy range query (not inside `record()`), aggregation, the chart, a custom date range.
- **Constraints:** never on a member's profile (parity: "Her reading days and progress are never shown"); no
  streaks, goals or sentences (the owner's earlier rule, parity "Profile").
- **Tier:** P3 (WP-20), after the week model of WP-08.

**#14 Average rating → the unrated books, rated in place.**
- **Exists?** Partly. "{count} not rated yet" (`profile.figures.unrated`, DE "{count} noch nicht bewertet") is
  plain text (`components/profile/Figures.vue:42-47`). Only the Pages line is a button (`pagesMissing`, same file);
  that is the pattern to copy.
- **Rating in place:** `UiRatingInput` exists (in `FinishSheet` and `EditSessionSheet`), but saving goes through
  `history.draft → repo.updateSession` with a full `SessionEdit` (`stores/history.ts:143`, `data/library.ts:1005`).
  A rating-only write wrapper is new.
- **Size:** part 1 (the sheet) S, in WP-06; part 2 (rating inline) M, WP-07.
- **Tier:** P1 / P2.

**#15 Ratings bars tappable.**
- **Already done:** every star row is a button that opens the stars sheet (`components/profile/Ratings.vue:30-46`,
  `pages/profile/index.vue:130-132`; on member pages too).
- **Left:** "{count} not yet" (`profile.ratings.notYet`) is plain text. It opens the same `unrated` sheet as #14.
- **Size:** S.
- **Tier:** P1 (WP-06).

**#16 Genres: a sheet instead of the Library.**
- **Exists?** Yes, the redirect does: `libraryView.showGenre(…)` then `navigateTo('/library')`
  (`pages/profile/index.vue:139-142`, `pages/profile/[year].vue:95-97`). Member profiles have no Genres block.
- **Approach:** a `readsOfGenre` selector using the same `bookGenres.ofEntry`. Keep "Show in Library" in the
  sheet's foot, so the old path is not lost.
- **Size:** S–M.
- **Tier:** P1 (WP-06).

**#17 Paginate long sheets.**
- **Exists?** Not at all. `ProfileReadsSheet` renders every read (`components/profile/ReadsSheet.vue:24`). The
  sheet body is a plain `overflow-y-auto` (`components/ui/Sheet.vue:310`). There is no virtual list or
  infinite-scroll helper anywhere (`composables/useNearView.ts` only lazy-loads covers).
- **Data:** client-side (`stats.record.reads` holds every closed read), so pagination is render-only.
- **Watch:** `useSheetRestore` restores scroll on Back (`stats.keptSheet`) and must also restore how many rows
  were shown.
- **Size:** S, but it is the base of #12, #14, #15 and #16.
- **Tier:** P1, as an enabler (WP-05).

### Social and the Friends feed

**#18 Compact feed rows.**
- **Exists?** A compact variant exists for Home only (`compact` prop, no review, want or heart). The feed row is
  `flex items-start gap-ml py-ms` with a 72 px cover (`--size-cover-md`), title, author, stars and a review folded
  at four lines (`components/friends/FeedRow.vue:80`).
- **Size:** S–M: `FeedRow.vue`, `FeedBatch.vue`, the placeholder `components/friends/RowPlaceholder.vue` (its
  height must match, or the list shifts), `pages/friends/index.vue`.
- **Risk:** 44 px targets; the cover flight assumes the cover size.
- **Tier:** P1 (WP-04). It needs an owner pick between two variants.

**#19 Follower system and social counts.**
- **Premise:** mostly wrong. The follower system has shipped:
  - `follows`, requests, blocks and the follow link (`20261017010000_social_settings.sql`, `20261017020000_social_follows.sql`).
  - The People page with Following, Followers and Requests (`pages/friends/people.vue`).
- **Counts:** shown nowhere, by design (see §3).
- **Once sign-up opens (#331):** public counts are still not worth it.
  - On a private account they leak the size of her circle to anyone who can see the card.
  - They invite comparison, and throwaway accounts inflate them.
  - A **self-only** variant is cheap and leaks nothing: her own Following, Followers and Requests counts on People,
    never shown to anyone else.
- **Tier:** P4, parked (WP-23; the self-only variant can be pulled forward at any time).

### List views and filters

**#20 Grid or list.**
- **Exists?** Not at all.
  - The Library has the segments `want_to_read | reading | finished` (`pages/library.vue:35`). Want and Finished
    are `LibraryEntryRow` lists; Reading is already cards.
  - The view per status (sort and filters) is kept on the device (`LIBRARY_VIEW_KEY`, `data/libraryView.ts:288`)
    with no layout field.
- **Collection page:** a numbered, draggable list. A grid with drag-reorder is hard, so phase 1 is the Library
  only.
- **Size:** L.
- **Tier:** P3 (WP-15).

**#21 "Reading since" in every view.**
- **Already done in the list views** (see §3). In a grid it comes with the grid cell, and "Reading since" only
  applies to Currently reading, which #20 excludes from the grid.
- **Tier:** carried in WP-15.

**#22 A loading animation when filters change.**
- **Not recommended.** The filter is synchronous (`arranged = computed(…)`, `pages/library.vue:79-80`) over the
  device's Library. Rows already animate in and out (`components/ui/ListMotion.vue`).
- A spinner would add delay that does not exist. If the owner sees jank with a very large Library, the real fix is
  measuring (`web/perf/`) and, if needed, virtualising the list (L). Neither is planned until there is a number.

**#23 A new status "On Hold".**
- **Exists?** Not at all: no `paus` or `hold` anywhere in the schema, app, i18n or importers.
- **Premise:** correct, but it collides with the glossary: Status is derived from Reading sessions
  (`CONTEXT.md:21-22`; `entry_status_of`, `20261003102707_reading_sessions.sql:112-126`, enforced by the trigger
  `library_entries_derive_status`).
- **The consistent model:** a **paused open session** (`reading_sessions.paused_on`) that derives a new status
  value `paused`. Not a client-written entry status: the trigger would overwrite it.
- **Size:** L, split into three packages (WP-17, WP-18, WP-19). Every place it touches is in §5.4.
- **Tier:** P3.

### Year in review

**#24 Stronger month dividers.**
- **Exists?** Faint: `.month + .month { border-top: var(--stroke-hairline) solid var(--color-hairline) }`
  (`components/profile/MonthBooks.vue:118-120`), a 0.5 px hairline at 10 % ink. `--color-hairline-strong` exists
  (`docs/DESIGN.md`, tokens).
- **Size:** S, one token. It also shows on a member's year.
- **Tier:** P1, carried in WP-01.

**#25 "The favourite" → every five-star book.**
- **Exists?** One favourite: the highest-rated read, newest on a tie (`data/stats.ts:298`), drawn as one lit card
  (`components/profile/Favourite.vue:22`). The card is used by both year pages.
- **"Five stars":** the Ratings block counts 4.75 as four (`starOf`, `data/stats.ts:72`), so "five stars" must mean
  exactly 5.00, and `readsWithStars(reads, year, 5)` (`:228`) already returns that set.
- **Size:** M.
- **Tier:** P2 (WP-09).

### Bugfixes

**#26 iOS: the 3D Stack and row cannot be scrolled.**
- **Exists?** No iOS-specific handling anywhere in Regal. Both surfaces scroll by JavaScript on pointer events,
  with native touch scrolling switched off. The analysis is in §5.5.
- **Size:** M, mostly diagnosis.
- **Where the fix belongs:** in **Regal**.
- **Tier:** P0 (WP-02).

### Import

**#27 High-resolution Goodreads covers.**
- **Already true on `main`.**
  - The export has no cover column (`tests/fixtures/goodreads/library_export.csv:1`).
  - Covers come from `resolveBookCover` (`data/covers.ts:201-260`): Apple stored at 600×900 (`appleCandidate`,
    `:178-182`, `COVER_LARGE`) and Open Library at `-L` (`:184`). A probe rejects anything under 150 px or a
    placeholder.
  - Tests assert the large forms (`tests/covers.test.ts:149` `100x100bb → 600x900bb`, `:153-154` `-L`).
- **What is left is part of `feat/import-cover-backfill`.** Its worker is building a background resolver
  (`data/coverFill.ts` per its `docs/plans/cover-sources.md`: Open Library by cover id at `-L`, Apple search).
- **Hand to that worker as one acceptance criterion:** "covers the resolver fills are stored through the same
  `appleCandidate` / `openLibraryCandidate` helpers, so at 600×900bb / `-L`, with a test."
- **No package here.**

---

## 5. Shared designs (decided once, used by several packages)

### 5.1 One books sheet (#12, #14, #15, #16, #17, and #11's week sheet)

Today there is one sheet component, `ProfileReadsSheet` (props `title`, `reads`, `withYear`, `foreign`, `testid`,
`restore`; slots `top` and `foot`), with `ProfileReadRow` rows. Back after opening a book restores the sheet
(`composables/useProfileSheet.ts` → `useSheetRestore.ts`, `stats.keptSheet`).

The `ProfileSheet` union in `stores/stats.ts:7-11` (`month | stars | pagesMissing | day`) is switched over **four
times**: in `pages/profile/index.vue:111-142`, `pages/profile/[year].vue`, `pages/friends/[member]/index.vue` and
`pages/friends/[member]/[year].vue`, each with its own `sheetTitle` / `sheetReads`.

**Design (WP-05):**
- **One switch:** a `useStatsSheet(reads, …)` composable maps a `ProfileSheet` to `{ title, reads, withYear }`, and
  the four pages use it.
- **New kinds** are one case each:
  - `author` (WP-06), `genre` (WP-06), `unrated` (WP-06/07), `week` (WP-08).
  - Each has a pure selector in `data/stats.ts` (`readsByAuthor`, `readsOfGenre`, `readsUnrated`, `readsInWeek`),
    unit-tested in `web/tests/stats.test.ts`.
- **Pagination:** `ProfileReadsSheet` renders 30 rows, then a **Show more** button appends 30 more.
  - A button, not auto-load: it is accessible, it keeps focus, and it is deterministic to restore.
  - `keptSheet` gains `shown`, so Back restores the count *and* the scroll.
  - No RPC: the rows are already on the device.
- **Row slots:** a per-row action slot for WP-07's inline rating; nothing else changes in the row.

### 5.2 One visibility model for Collections (#2, #6, later #8)

- **Column:** `collections.visibility text not null default 'private' check (visibility in ('private','followers'))`.
  Text with a check, not an enum, so a later `'page'` (the public reading page) is a one-line change.
- **Default:** private for every existing and new Collection. Sharing is opt-in per Collection. After the public
  launch (revision 2) this is a hard rule, not a preference: no bulk "make all visible".
- **Who sees it:** whoever `private.visible(caller, owner)` allows (a public account, or an accepted follower),
  never a requester, a blocked member or a stranger to a private account. This is the same rule as her other
  sections.
- **Reads:** `member_collections(p_member)` returns name, count of *visible* entries and four covers, newest edited
  first. `member_collection(p_member, p_collection, p_after, p_limit)` returns its entries in her order, paginated.
  - Both are security definer, `set search_path = ''` (the lint test), and filter `not e.hidden`.
  - Manual books are shown the way her reads show them (her followers see them but cannot open them).
- **Write:** `set_collection_visibility(p_collection, p_visibility)`, **online only**, like every social write
  (`docs/proposals/social-v1.md:30`, the outbox never queues one). So **no `sync_write` change**, which keeps WP-11
  out of the `sync_write` chain.
- **Table RLS stays owner-only.**
- **No new section switch** in `social_settings`: the per-Collection opt-in is the switch. This is an open
  question for the owner (WP-11).

### 5.3 Manual order next to "last edited" (#7 vs #302)

- **Sort mode** per member: `recent` (default; exactly #302) or `manual`.
- **Storage (recommended):**
  - The mode is kept on the device, like the Library's view (`data/libraryView.ts:288` pattern). It is a view
    preference, and no migration is needed for it.
  - The manual *order* lives in the database (`collections.position`), so it is the same on every device.
  - The alternative, the mode on the server (an `accounts` column), syncs the picker everywhere; it is an open
    question (WP-14).
- **`reorder_collections(p_ids uuid[])`:**
  - Raises `order_mismatch` unless `p_ids` is exactly her Collections.
  - Must **not** bump `updated_at` (the trigger `collections_touch` fires on a rename only; keep it so).
  - Gets a `sync_write` action, because the entries' reorder is offline-capable too.
- **New Collection in manual mode:** goes on top (open question).
- **Where the mode applies:** the Collections page, the picker, the book page's chips and the Library row's fan
  follow it.
- **Held order:** `useEditedOrder` (`utils/editedOrder.ts`) applies to `recent` only.

### 5.4 On Hold: every place it touches (#23)

**Model:**
- `reading_sessions.paused_on date null`, with check `paused_on is null or outcome is null` (open sessions only).
- `entry_status` gains `paused`.
- `entry_status_of` returns `paused` when the open session has `paused_on`.
- One open session per entry stays (`reading_sessions_one_open`), so progress, dates and "Read again" keep working.
- **Migration split:** `alter type … add value` cannot be used in the transaction that adds it, so it is **two
  migration files**: the enum value first, everything else after.

**Database (WP-17)**, the latest definition of each function:
- `entry_status_of` and the triggers `library_entries_derive_status` and `reading_sessions_update_status`
  (`20261003102707_reading_sessions.sql:112-172`).
- `start_reading` (`:226`, status checks `:247`, `:250`).
- `abandon_reading`, `read_again` (`20261003105500_abandon_and_read_again.sql:41,102,123,126`).
- From `20261025010000_social_v2a.sql`:
  - `finish_reading` (`:59`), `update_session` (`:125`), `add_first_session` (`:219`), `add_to_library` (`:276`),
    `add_manual_book` (`:328`), `sync_write` (`:427`, the `p_status` cast).
  - `feed()` (`:761`), `member_profile` (`:861`, counts and the `want` and `reading` sections), `public_reading_page`
    (`:1031`), `public_book_card` (`:1102`), `circle_reading` (about `:1448`; open sessions, so it must exclude paused),
    `circle_want`.
- `book_readers` (`20261025040000_book_readers.sql:92-118`, precedence).
- `import_books` (latest `20261009100000`), `update_progress`, `change_edition`, `started_series*` (recheck their
  status literals).
- New: `pause_reading(entry)` and `resume_reading(entry)`, plus `sync_write` actions.
- pgTAP: a new `paused_test.sql`, and a review of the 41 test files that assert statuses.

**App (WP-18):**
- Types: `EntryStatus` (`data/library.ts:18`); `ADDABLE_STATUSES` and `STATUSES` (`stores/library.ts:34,96`);
  `lists: Record<EntryStatus,…>` (`data/deviceLibrary.ts:43`). The device copy must tolerate an unknown status (see
  the risk below).
- Library: segments (`pages/library.vue:35`); `STATUSES`, `SORTS`, `FACETS` and `defaultSort` (`data/libraryView.ts:60-85`);
  the sort day by status (`data/library.ts:515-516`); `ViewBar`, `SortSheet`, `FilterSheet`.
- Book page: the status line and actions (`pages/book/[key].vue:141-143, 292-340`). Pause and Resume: Resume where
  Update progress is; Pause in the ⋯ sheet (`components/book/OptionsSheet.vue`).
- Home: Currently reading (`pages/index.vue:76-86`, `HomeReadingCard`), `utils/wantToRead.ts:35-36`,
  `utils/launch.ts:22`.
- Search badge `status.${entry.status}` (`components/search/ResultRow.vue:79`); `collections/EntryList.vue:357`;
  `library/EntryRow.vue:67`; `author/WorkRow.vue:112,120`; `reader/Reader.vue`.
- Stats: the head counts `.eq('status', …)` (`data/stats.ts:339-340`) and the Library line `profile.library`.
- Offline queue `data/queuedWrites.ts` (status literals at about `:164-230`, lists at `:290-309`) and the `sync.action.*`
  strings.
- Friends: `utils/memberProfile.ts:73`, `utils/friendsView.ts`, `utils/bookReaders.ts:14-15`,
  `components/friends/AlsoAvatars.vue`.
- Shelf: `MEMBER_SHELF_STATUSES = ['read','currently-reading']` (`data/memberShelf.ts:36`).
- Regal export `regalStatus` (`data/export/regal.ts:114-119`; Regal's file format allows any non-empty string);
  `data/export/memberLibrary.ts`.
- i18n: `status.*` (EN "Want to read", "Currently reading", "Finished", "DNF"; DE "Möchte ich lesen", "Lese ich
  gerade", "Gelesen", "Abgebrochen", at `en/de.json:528`); `add.needs.*`; `library.view.*`.
- Docs: `CONTEXT.md` (Status, Reading session, a new *On hold* term) and `docs/parity.md` (Search, Book, Add sheet,
  the Status part with the literal list at `:299`, Start sheet, Library).

**Importers (WP-19):**
- Goodreads `STATUS_SHELVES` (`data/import/goodreads.ts:80`). Today a custom `on-hold` or `paused` shelf becomes a
  Collection and an `otherShelf` note.
- Hardcover (`data/import/hardcover.ts:182-207`; check Hardcover's own status list for "Paused").
- Fable (`data/import/fable.ts:99-104`).
- `data/import/rows.ts`, `components/import/Counts.vue`.
- Reado: PR #294 is open and adds its own mapping, so WP-19 comes after it.

**Risk: installed apps.**
- An old PWA that receives `status = 'paused'` for an entry paused on another device indexes `lists[status]` and
  breaks.
- Mitigation: WP-18 ships the tolerant read (an unknown status is treated as `reading`) **in a release before** any
  client can call `pause_reading`. Alternatively, WP-17's RPCs stay ungranted until WP-18 is released.
- The migration on its own is inert: nothing pauses until the app's button exists.

### 5.5 #26: what is known about the iOS scroll bug

**Where the code comes from:**
- Libellus builds Regal from a local checkout (`REGAL_LAYER`) or from the **default branch of `fabkho/regal`,
  unpinned** (`web/regal.config.ts:17-25`).
- `/Users/fabkho/code/regal` is a stale checkout (`b82bf40`, before the row existed). Read `origin/main` (`3376fce`).

**The row** (`RegalBooksRow`, `app/components/row/Card.vue` in Regal):
- The scroller is `overflow-x: auto` with **`touch-action: pan-y`** (`Card.vue:1065-1074`). The browser never
  scrolls it sideways; JavaScript moves `scrollLeft` from `pointermove` instead (`onPointerDownCapture` `:249`,
  `onTouchDragMove` `:258`).
- `onTouchDragEnd` drops the drag on any `pointercancel`.
- **Why it exists** (`app/utils/row/touchDrag.ts:1-8`): Chrome turns a native touch scroll into a `pointercancel`,
  which blocks `navigator.vibrate` for the scroll ticks.
- **iOS has no Vibration API**, so iOS carries all of this workaround's risk and none of its benefit.

**The Stack** (`app/components/stack/Scene.vue`):
- The canvas is `touch-action: none` (`app/components/LibraryStage.vue:335`). Scrolling is `pointerdown` on the
  canvas with `pointermove` and `pointerup` on `window`, and no `setPointerCapture`.
- `onPointerMove` drops the drag unless `event.buttons & 1` (`Scene.vue`, `onPointerMove`).

**Libellus:**
- The shelf page is `fixed inset-0 … overflow-hidden` (`pages/profile/shelf.vue:91`).
- `html, body { overflow-x: clip; overscroll-behavior-x: none }` (`assets/css/main.css:349-357`).
- The modal lock only sets `overflow: hidden` (`composables/useModalLayer.ts:57`); there is no `position: fixed`
  body lock, the classic iOS trap.

**Ranked hypotheses (none reproduced; no iOS device is available to workers):**
1. **Row: WebKit ends or never starts the JavaScript drag.**
   - With `pan-y` the native sideways pan is off, so if iOS WebKit delivers `pointercancel` (a vertical pan claimed
     by the page) or coalesces moves differently, the row cannot move at all.
   - **Cheapest fix:** use the JavaScript drag only where `'vibrate' in navigator`, and give every other browser
     native scrolling (`touch-action: pan-x pan-y`). That is a small, low-risk Regal change, and Android keeps its
     ticks.
2. **Stack: the `buttons & 1` guard and the missing pointer capture.**
   - If WebKit's touch `pointermove` reports `buttons` differently, or the window listener misses moves, the Stack
     drag stops at once.
   - **Fix:** skip the `buttons` guard for `pointerType !== 'mouse'`, `setPointerCapture` on `pointerdown`, listen
     on the element, and handle `pointercancel` explicitly.
3. **Libellus' global `overscroll-behavior-x: none` and `overflow-x: clip` on `html`** interacting with an inner
   scroller. This is the weakest candidate; it is a Libellus change only if 1 and 2 do not explain it.
4. **The build is unpinned:** the Regal running in production may not be the one anyone reads. WP-02 records the
   Regal commit of the deployed build.

**What a worker can test:**
- Playwright's WebKit with the iPhone 15 device (`web/playwright.config.ts:68-70` already uses it; WebKit builds are
  installed locally).
- Synthetic `PointerEvent`/`TouchEvent` sequences, which prove the handler logic (cancel, `buttons = 0`) in Regal's
  own tests.
- It **cannot** test iOS's native gesture arbitration. Only the owner's iPhone can (Safari, and the home-screen
  app), with Safari Web Inspector over USB and a diagnostic overlay that WP-02 adds behind a query flag.
- **Blocker:** building Libellus with the shelf needs `LIBELLUS_REGAL=1` and `REGAL_LAYER` or `GIGET_AUTH`; the
  worker works in a fresh Regal worktree.

---

## 6. Ordering constraints (read before dispatching anything)

1. **The BetterReads rename** (merged as #311 on 2026-10-11: new copy uses "BetterReads"; the points below are history).
   - New copy never writes the app's name. Where a string must name the app, it waits for the rename, then uses
     "BetterReads".
   - The rename touches `web/i18n/locales/en.json` (brand strings only) and `docs/parity.md`, which every package
     edits, so rebase after it lands. The conflicts are small and textual.
   - **WP-12, WP-16 and WP-22** edit the privacy notice (`web/app/legal/privacy.ts`, 14 mentions of the name, not in
     the rename's diff today). Start them after the rename has merged, so the notice is reviewed once under the new
     name.
2. **PR #294** (Reado import, open) adds an importer and a status mapping. WP-19 comes after it, and any migration
   numbered here is rebased past whatever #294 adds.
3. **`feat/import-cover-backfill`** (running) owns covers in the import; #27 is not dispatched separately (§4).
4. **Migrations** start after `20261026020000_collections_updated_at.sql`. Each package picks its timestamp when it
   is written, later than the latest on `main` at that moment.
5. **SQL functions are redefined in full** (`create or replace` with the whole body). Two open PRs that redefine
   the same function silently drop each other's changes.
   - **One package at a time per function**, each starting from the latest definition on `main`.
   - The chain: `sync_write` (WP-14 → WP-17); `member_profile` and `private.my_social_json` (WP-11 if a section
     switch is chosen → WP-16 → WP-17); `public_reading_page` and `feed` (WP-17); `delete_my_account` (WP-21).
   - This is why the LOW chain is long (§8).
6. **Tests:** Vitest (`web/tests/`, repositories against the local stack) and pgTAP (`supabase/tests/`). Playwright
   runs **locally only** (the iPhone 15 WebKit project); no package adds e2e to CI. No full typechecks.
7. **German:** every new key in `en.json` and `de.json`. `tests/i18n-parity.test.ts` enforces parity; translate with
   `pnpm i18n:translate` under `web/i18n/kit/glossary.json` (decisions in `docs/i18n/german-glossary.md`: Autor
   with no gender sign, "Lese ich" short form, …). Check 390 px for German length (`docs/i18n/german-pass.md`).
8. **Parity:** every screen change updates its `docs/parity.md` section (states, actions, keys, IDs).
9. **Open sign-up (revision 3: postponed, issue #331).**
   - WP-24, WP-25 and WP-27 do not start until the owner opens #331.
   - While sign-up is invite-only, the packages that show member-written content to others keep their order: WP-12
     (Collection names), WP-16 (bio), WP-21 (images) and WP-22 (links).
   - Before sign-up opens, each of them must have its report reason (WP-25) and the text rule (WP-26).
   - Whichever lands later adds the missing piece: if WP-22 lands first, WP-25 adds the "links" reason.

---

## 7. Work packages

Each package also has an issue draft in `backlog-issues/NN-slug.md`.

### WP-01 Profile quick fixes (#1, #11a, #24). **Shipped in 1.15.0 (#309).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history).

### WP-02 iOS shelf scrolling (#26). P0 · **row shipped (regal#84, in every build since 1.17.0); the Stack still needs the owner's iPhone check** · fix only if it fails: M · Opus · in the Regal repo
- **Revision 4:** regal#84 ("the row scrolls natively under a finger, the Stack keeps its drag") did hypothesis 1. The
  Stack (hypothesis 2: the `buttons & 1` guard, no pointer capture) is untouched. Regal is still unpinned
  (`web/regal.config.ts`): pinning it is part of this package.
- **Why its own package:** another repository, a diagnosis loop with the owner's phone, and no Libellus files
  unless hypothesis 3 holds (§5.5).
- **Steps:**
  1. In a fresh worktree of `fabkho/regal` at `origin/main`, add a diagnostics overlay behind `?touchdebug`. It
     shows the pointer and touch event sequence (`type`, `pointerType`, `buttons`, cancels), the computed
     `touch-action` and `scrollLeft`.
  2. Fix the row: use the JavaScript drag only where `navigator.vibrate` exists, otherwise native scroll.
  3. Fix the Stack: no `buttons` guard for touch, `setPointerCapture`, `pointercancel` handling.
  4. Add unit tests in Regal (`tests/unit/rowTouchDrag.test.ts` and a Stack equivalent) that replay touch sequences,
     including `buttons = 0` and `pointercancel`.
  5. The owner checks a preview on his iPhone, in Safari and as the home-screen app.
- **Libellus:** only `assets/css/main.css:349-357` if needed. Suggest pinning the Regal commit in
  `web/regal.config.ts` (today it floats on the default branch); ask first.
- **Migration:** no. **German:** none.
- **Acceptance:**
  - On the owner's iPhone, the Profile's row and a year's row swipe sideways, and `/profile/shelf`'s Stack
    scrolls and flings.
  - The page still scrolls vertically over the row.
  - Android unchanged, scroll ticks included.
  - Regal's unit tests green.
- **Open questions:** which iOS version? Safari tab, home-screen app, or both? Which screens exactly? Did it ever
  work on iOS? Pin Regal in Libellus?

### WP-03 Tap the name to edit it (#3). **Shipped in 1.15.0 (#310).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history).

### WP-04 Compact feed rows (#18). **Shipped in 1.15.0 (#314), 1.15.1 (#318).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history).

### WP-05 One paginated books sheet (#17 + refactor). **Shipped in 1.16.0 (#322).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history).

### WP-06 Tappable stats (#12, #16, #15, #14 part 1). **Shipped in 1.19.0 (#335).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history).

### WP-07 Rate from the unrated sheet (#14 part 2). **Shipped in 1.20.0 (#346).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history). `components/profile/RateRow.vue` in `ReadsSheet.vue`, written through `stores/history.ts`.

### WP-08 By month or by week, with a navigator (#11b, #11c). **Shipped in 1.26.0 prototype (#345), 1.27.0 (#414), 1.28.0 (#442).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history). Shipped as the animated capsule (`components/profile/Chart.vue`, `ChartNav.vue`). It also works under All.

### WP-09 Every five-star book of the year (#25). **Shipped in 1.16.0 (#321).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history).

### WP-10 Collection page: + add, and sort (#10, #9). **Shipped in 1.15.0 (#313).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history).

### WP-11 Collection visibility, database (#6, #2). P3 · L · Opus · revision 4: wave 3+, not while WP-17 holds the Opus slot; check the `libellus-friends-visibility` worktree first
- **Scope:** §5.2: the column, `set_collection_visibility`, `member_collections`, `member_collection`. No
  `sync_write` change.
- **Files:** a new `supabase/migrations/2026…_collection_visibility.sql` and
  `supabase/tests/collection_visibility_test.sql`.
- **German:** none (DB only).
- **Tests (pgTAP):**
  - Private is invisible to everyone else.
  - `'followers'` is visible to an accepted follower and to anyone on a public account, and invisible to a
    requester, a blocked member (both directions) and a stranger to a private account.
  - Hidden entries are not listed and not counted.
  - Another member's id gives `collection_missing`.
  - Pagination; the lints test (definer `search_path`).
- **Acceptance:** every case above as a pgTAP test; existing Collections are private after the migration; the
  table's RLS is unchanged.
- **Open questions:** private by default (recommended)? A section switch in Privacy as well? Ever on the public
  reading page?

### WP-12 Collection visibility, app (#6, #2). P3 · M–L · normal · revision 4: wave 4+ (after WP-11, WP-14) · **safe while invite-only; revisit before open sign-up (#331)**
- **Revision 2:**
  - A visible Collection's name is content strangers can see (on public accounts, or once links travel).
  - Making a Collection visible therefore runs the name through WP-26's text rule (no URLs, no control
    characters), and WP-25 gets a "Collection" report reason with an owner action to make it private again.
  - Private by default, opt-in per Collection: no bulk "make all visible".
- **Files:**
  - The Collection's options sheet in `pages/collections/[id].vue` (a "Visible to followers" switch, online only).
  - A visibility mark on rows in `pages/collections/index.vue`.
  - `data/collections.ts` / `stores/collections.ts`.
  - `pages/friends/[member]/index.vue` (a Collections section).
  - A new read-only `pages/friends/[member]/collections/[id].vue`.
  - `app/legal/privacy.ts` (EN `:34` and the line about who reads what; DE as well).
  - `CONTEXT.md` (Collection); parity.
- **German:** `collection.visibility` ("Visible to followers" / "Für Follower sichtbar"), `collection.visibilityHint`,
  `collections.visible`, `member.collections`, `member.collectionsAll`.
- **Tests:** Vitest repository against the local stack; `tests/member-profile.test.ts`; `e2e/friends.spec.ts` locally.
- **Acceptance:**
  - Switching a Collection on shows it on her profile to a follower and on no one else's view.
  - Switching it off removes it at once.
  - Hidden Books never appear.
  - The privacy notice says which Collections followers can see, in EN and DE.
- **Open questions:** a member's Collection as a page (recommended) or a sheet? Where on her profile?

### WP-13 Refactor: a reusable reorder list. P2 (enabler) · M · normal · revision 4: wave 1
- **Scope:** move the pointer, hold, keyboard and live-region logic of `components/collections/EntryList.vue` into
  `composables/useReorderList.ts`. There is **no behaviour change**.
- **Tests:** Vitest for the index maths and the keyboard moves.
- **Acceptance:** the entries reorder exactly as before (touch hold of 350 ms, grip drag, arrows, Home and End,
  announcements); parity unchanged.
- **Open questions:** none.

### WP-14 Manual order of Collections (#7). P2 · L · normal · revision 4: wave 2 (after WP-13)
- **Scope:** §5.3.
- **Files:**
  - A migration (`reorder_collections`, a `sync_write` action) and pgTAP.
  - `data/collections.ts`, `stores/collections.ts`, `data/queuedWrites.ts`.
  - `pages/collections/index.vue` (drag in manual mode, the mode control), `components/collections/PickerSheet.vue`,
    `LibraryLink.vue`, `utils/editedOrder.ts`.
  - Locales; parity (`:717` rewritten).
- **German:** `collections.sort.recent` ("Last edited" / "Zuletzt bearbeitet"), `collections.sort.manual` ("Your
  order" / "Eigene Reihenfolge"), `collections.move` / `moved` / `dropped`, `sync.action.reorderCollections`.
- **Tests:**
  - pgTAP: `order_mismatch`, no `updated_at` bump, `sync_write` replay.
  - Vitest: the store in both modes, offline.
- **Acceptance:**
  - In manual mode, a dragged order holds on the page, in the picker and in the Library row, and on another device.
  - Switching to recent shows #302's order.
  - Keyboard reordering is announced.
  - An offline reorder syncs.
- **Open questions:** the mode per device (recommended) or per account? A new Collection on top or at the end in
  manual mode?

### WP-15 Grid or list in the Library (#20, #21). P2 · L · normal · revision 4: wave 1
- **Files:**
  - `data/libraryView.ts` (`ListView.layout`, back-compatible parse at `:301`), `stores/libraryView.ts`.
  - `components/library/ViewBar.vue` (the toggle, `aria-pressed`).
  - A new `components/library/GridCell.vue` (the cover, and one date line per status: "Added {date}", stars and the
    day, "DNF · {date}").
  - `pages/library.vue` (Want and Finished; Finished keeps its sticky years).
  - Locales; parity (Library, Library filters and sort).
- **German:** `library.view.layout.list` and `.grid` ("List" / "Liste", "Grid" / "Raster").
- **Tests:** Vitest `listViewFromJson` with old stored JSON.
- **Acceptance:**
  - The toggle on Want to read and Finished, kept per status on the device; none on Currently reading.
  - Three columns at 390 px.
  - Each cell keeps its date line.
  - Covers lazy-load (the first eight eager).
  - The cover flight works from a cell.
- **Open questions:** per status or one layout for all? The Collection page too (only while sorted, since drag
  stays a list)? A duration ("for 12 days") instead of a date?

### WP-16 A short bio (#4). P3 · M · normal · revision 4: after #331 opens (WP-26), or sooner with its own minimal rule if the owner asks · **safe while invite-only; revisit before open sign-up (#331)**
- **Revision 2:**
  - `set_bio` uses WP-26's shared rule: at most 160 characters, no URLs, e-mail addresses or phone numbers (the
    spam pattern), no control, bidi or zero-width characters.
  - WP-25 gets a "bio" reason and an owner action that clears it.
  - No profanity list: false positives (the "Scunthorpe" problem) in two languages, and the report flow is the
    answer.
- **Files:**
  - A migration: `accounts.bio text check (char_length(bio) <= 160)`; `set_bio` (trim, collapse whitespace, no control
    characters, null when blank); returned in `member_profile` and the own social JSON; pgTAP.
  - `components/profile/Hero.vue`, `components/friends/MemberHero.vue:27-28`, a bio sheet, a row in `Account.vue`.
  - `app/legal/privacy.ts` (the profile data category, EN and DE).
  - Locales; parity (Profile, A member's profile).
- **German:** `account.bio` ("Bio" / "Über mich"), `account.bioTitle`, `account.bioPlaceholder`, `account.bioCount`.
- **Tests:** pgTAP (length, blank → null, visibility like her other sections, hidden from blocked members); Vitest
  repository.
- **Acceptance:**
  - She sets, edits and clears a bio of up to 160 characters.
  - It shows as plain text (no links, no markup) under her name to those who may see her profile, and on her own
    Profile.
  - Deleting the account removes it.
  - The privacy notice names it.
- **Open questions:**
  - Length: 160?
  - Line breaks: none?
  - Who sees it: whoever sees her profile (recommended), or also on a private account's card, like the photo?
  - The German word.

### WP-17 On Hold, database (#23). P2 · L · Opus · revision 4: wave 3 (after WP-14; re-audit the SQL first, see "contradictions" 2)
- **Scope:** §5.4, database: two migration files, `pause_reading` and `resume_reading`, `sync_write` actions, and
  every function listed there.
- **German:** none.
- **Tests:** a new `supabase/tests/paused_test.sql`, plus updates where existing tests enumerate statuses.
  - Pause and resume keep the dates and progress.
  - Finishing or abandoning a paused read clears the pause.
  - `start_reading` on a paused entry says resume.
  - `circle_reading` and the feed leave paused out.
  - `member_profile` counts follow the chosen section.
- **Acceptance:**
  - Every function in §5.4 is reviewed, with a test or a note.
  - The migration is inert for existing data.
  - The RPCs are granted only when WP-18's tolerant client has shipped (or they go in that release).
- **Open questions:**
  - Does Update progress on a paused book resume it (recommended: yes)?
  - Do followers see paused books, and under which switch (recommended: with Currently reading, `show_reading`)?
  - A feed event (recommended: none)?
  - Can a book be added straight as On hold?

### WP-18 On Hold, app (#23). P2 · L · normal (Opus review) · revision 4: wave 4 (after WP-17, WP-15)
- **Scope:** §5.4, app; every file listed.
- **Recommended UI:**
  - Paused Books as a quiet section at the end of the Currently reading segment, not a fourth segment: four segments
    do not fit 390 px in German (`docs/i18n/german-glossary.md` D3 already shortens "Lese ich").
  - Pause in the book's ⋯, and Resume where Update progress is.
  - "Paused since {date}" on the card.
- **German:** `status.paused` ("On hold" / "Pausiert"), `book.pause` ("Pause" / "Pausieren"), `book.resume`
  ("Resume" / "Weiterlesen"), `book.pausedSince`, `library.paused`, `sync.action.pause|resume`.
- **Tests:** Vitest for the device copy with an unknown status, the offline queue (pause, resume) and the stats head
  counts.
- **Acceptance:**
  - Pause and Resume from the book page, offline too.
  - Paused Books leave Home's Currently reading and stay findable in the Library.
  - Search shows "On hold".
  - Not on the shelf, or shown as being read (as decided).
  - An unknown status never breaks an old copy.
  - `CONTEXT.md` and parity updated.
- **Open questions:** a section or a segment? Do paused count in the Profile's Library line? Shown on the shelf?

### WP-19 On Hold, importers (#23). P3 · S–M · Haiku / normal · revision 4: wave 5 (after WP-18); the Hardcover zip already notes Paused
- **Files:** `data/import/goodreads.ts:80` (`on-hold`, `paused`, `on hold` shelves become a paused open read),
  `hardcover.ts` (its Paused status, if it has one), `fable.ts`, `rows.ts`, `components/import/Counts.vue`, the Reado
  mapping from #294, `import_books` (if WP-17 has not already taught it).
- **Tests:** Vitest per importer with fixture rows.
- **Acceptance:** a Goodreads file with an `on-hold` exclusive shelf imports those Books as paused, not as a
  Collection; the counts on the import page show them.
- **Open question:** which shelf names count (in English and German)?

### WP-20 Pages read across books (#13). P3 · L · normal · revision 4: wave 1–2 (WP-08 shipped)
- **Files:**
  - `data/stats.ts` (`progressDaysIn(from, to)`, paginated, lazy; not inside `record()`).
  - `stores/stats.ts`.
  - A new `components/profile/PagesChart.vue`, reusing WP-08's ranges and `Columns.vue`.
  - `pages/profile/index.vue` (own profile only).
  - Locales; parity.
- **German:** `profile.pagesChart.*` ("Pages read" / "Gelesene Seiten", the range labels).
- **Tests:** Vitest aggregation (percent-only Books via `amountOf`, empty days).
- **Acceptance:**
  - Week, month and custom ranges (custom capped at 366 days) show pages a day.
  - Never on a member's profile.
  - No streaks, goals or sentences.
  - Loads only when opened.
- **Open questions:** where on the Profile (it may replace Reading days' figures)? The custom range's maximum?

### WP-21 A Collection's own cover (#8). P4 · L · normal · **parked unless members ask** (after WP-12, WP-14, WP-25; could reuse own covers #431–#437) · safe only while invite-only; revisit before open sign-up (#331)
- **Revision 2 prerequisites, if un-parked:**
  - 256 KB, webp/jpeg, re-encoded on the device (drops EXIF).
  - A path pinned per member and Collection; one file per Collection; a per-member cap in the insert policy.
  - Followers see it only on a visible Collection.
  - A "cover" report reason, and an owner action that deletes the file.
  - The storage budget checked against the Free plan.
- **Files:**
  - A migration: a private bucket `collection-covers` with avatar-style policies; `collections.cover_path`;
    `set_collection_cover`; `delete_my_account` (latest in `20261009120000_avatars.sql`) extended; pgTAP.
  - `utils/crop.ts`, `utils/avatarRaster.ts` (a 2:3 variant).
  - `components/collections/Mosaic.vue`, the options sheet.
  - `data/collections.ts`; `data/auth.ts` (the account purge); deleting a Collection deletes its file.
- **German:** `collection.cover`, `collection.coverRemove`, errors.
- **Tests:** pgTAP (policies, deletion); Vitest (raster).
- **Acceptance:**
  - Upload, crop and remove a cover.
  - The Mosaic shows it.
  - Followers see it only on a visible Collection.
  - Deleting the Collection or the account leaves no file.
- **Open question:** is this worth the cost at all? Recommended: only once #2 is live and members ask for it.

### WP-22 Social links (#5). **Shipped in 1.19.0 (#339).**
Its design and acceptance criteria were in revisions 1–3 of this file (see the git history). Shipped as `profile_links` and `profile_link_settings` (`20261028010000_profile_links.sql`, `utils/socialLinks.ts`, `components/profile/SocialLinksSheet.vue`), with five platforms: Instagram, TikTok, YouTube, Goodreads and Reado. Before open sign-up (#331) it needs only the "links" report reason; `owner_clear_profile_links` already exists.

### WP-23 Follower counts (#19). P4 · parked (revision 2: a self-only variant offered)
Counts were deliberately left out (`docs/proposals/social-v1.md:30,95`). Once sign-up opens (#331):
- **Self-only (S, any time):** her own Following, Followers and Requests counts on People (`pages/friends/people.vue`),
  from her own rows. Never shown to anyone else; no new privacy surface.
- **Public counts (M, still parked):**
  - They leak the size of a private member's circle, invite comparison and get inflated by throwaway accounts.
  - If they ever come back: only where `private.visible` allows, never for blocked members, through an RPC rather
    than a wider RLS, with pgTAP for each case.

### WP-24 Open sign-up safely. **Postponed (issue #331)** · M · Opus · do not start until the owner opens #331
- **Revision 3:** the switch is `signup_mode` with **default `invite`**, so merging it changes nothing until the owner
  flips it. The project limit of 30 mails an hour must be raised before that.
- **Why:** the invite gate is the app's only brake on sign-ups and on mail sent to unknown addresses (§2.1). Removing
  it without a replacement lets anyone make the app mail any address, and nothing caps photo uploads.
- **Check first:** whether the owner's launch work already opens sign-up; then only the remaining items stay.
- **Files and scope:**
  - **The gate:** a migration that turns `public.signup_invite` and its `auth.users` triggers into
    "invite optional". A setting such as `private.signup_mode` (`open` | `invite`) keeps the owner able to close
    sign-up again in one statement during an incident. An invite code given anyway is still recorded
    (`accounts.invite_code_id`). pgTAP: both modes, and the confirmation trigger.
  - **Sign-up screen:** no code field in open mode (`web/app/pages/sign-up.vue`, `data/auth.ts:167-178`, the
    `invite_*` error mapping `:84-87`), plus the line "I am 16 or older" as a required check
    (`signUp.ageConfirm`).
  - **Captcha:** Cloudflare Turnstile through Supabase Auth's captcha (`[auth.captcha]` in `supabase/config.toml`,
    `provider = "turnstile"`). The token goes with every `signInWithOtp` call, sign-in and sign-up alike, because both
    send mail. The site key is in the build config; the secret is in the Supabase dashboard. Add it to
    `docs/SETUP.md`.
  - **Email capacity (owner dashboard steps, written into `docs/OPERATIONS.md`):**
    - Supabase Auth's email rate limit and per-address frequency.
    - Resend's plan quota and domain warm-up.
    - The arithmetic: every sign-in is a mail.
  - **Photo cap:** the `avatars` insert policy also requires fewer than N objects in her folder (for example 4:
    two sizes, old and new during a swap), so a member cannot fill the bucket.
  - **Waitlist at launch:** the reading page's form (`components/reading/Waitlist.vue`) becomes a "Sign up" link.
    `join_waitlist`, the Waitlist page and `waitlist-invite` stay for the addresses already waiting, or are retired
    (owner's call).
  - `SPEC.md` (Access) and `docs/parity.md` (Sign up, Verify, Waitlist).
- **German:** `signUp.ageConfirm` ("I am 16 or older" / "Ich bin mindestens 16 Jahre alt"), captcha error copy, the
  sign-up intro without "invite-only" (`signUp.intro`).
- **Tests:**
  - pgTAP: open mode, invite mode, the confirmation trigger, the avatar cap.
  - Vitest: the auth repository with the captcha token passed.
  - Playwright locally only: the sign-up flow (`e2e/auth.spec.ts`).
- **Acceptance:**
  - A new address signs up without a code.
  - Without a valid captcha token no mail is sent.
  - A fifth photo object is refused.
  - The owner can switch back to invite-only with one statement (written in OPERATIONS).
  - The age line is required.
  - The email budget is written down with the dashboard values.
- **Open questions:**
  - Keep invite codes at all (for example to skip the captcha)?
  - What happens to the waitlist?
  - Turnstile or hCaptcha (Turnstile matches Cloudflare Pages)?

### WP-25 Report a member, and the owner's minimal handling. **Postponed (issue #331)** · M · Sonnet (Opus review of the SQL)
- **Why:** there is no way to report anything (§2.2). After the launch, names, photos and reviews come from
  strangers. The owner needs to hear about abuse, and members need a way to say it.
- **Scope (phase 1, no wave-1 file touched):**
  - **Where:**
    - "Report" in the member sheet's ⋯ (`components/friends/MemberSheet.vue`, from her profile and from People).
    - Reasons: *name*, *photo*, *a review*, *spam*, *someone under 16*, *other*.
    - An optional note of up to 500 characters.
    - After sending, the sheet offers **Block {name}** (the existing `block()`).
  - **Where reports go:** reuse `public.feedback`, with a new kind `report` and
    `context = { target_member, reason, target_kind, target_id }`. It brings its RLS, its rate limit (5 an hour,
    20 a day; `20261024010000_feedback.sql:4`) and the owner's inbox (`/profile/feedback`, a "Reports" filter) with
    it. A table of its own is a later refactor if volume asks for one.
  - **The owner's minimal handling** (owner-only functions, `private.is_instance_owner()`):
    - `owner_clear_member_name(member)`: clears `raw_user_meta_data.name`.
    - `owner_remove_member_photo(member)`: deletes her avatar objects and clears `accounts.avatar_path`.
    - `owner_clear_review(session)`: clears the review text and keeps the read.
    - Banning an account goes through the Supabase dashboard (Auth → Users → ban), written in the runbook (WP-27).
    - Every owner action is logged (who, what, when) for the statement of reasons.
  - **Phase 2 (after WP-04):** "Report" on a single review row in the feed and on her profile. Later reasons are
    added by WP-12 (Collection), WP-16 (bio), WP-22 (links) and WP-21 (cover).
- **German:** `report.title` ("Report {name}" / "{name} melden"), `report.reason.*`, `report.note`, `report.sent`
  ("Thanks. The owner reads every report." / "Danke. Jede Meldung wird gelesen."), `report.block`.
- **Tests:**
  - pgTAP: a member can file a report and cannot read others' reports.
  - pgTAP: owner functions refuse non-owners; the rate limit; clearing a name, photo or review.
  - Vitest: the repository.
- **Acceptance:**
  - From any member's profile, Report → reason → Send arrives in the owner's inbox with the target and reason.
  - The reported member never learns who reported her.
  - The owner can clear a name, photo or review from the inbox with one action each; the change shows everywhere
    (feed, profile, reading page).
  - The privacy notice covers reports (WP-27).
- **Open questions:**
  - Is the owner the only moderator?
  - Tell the reported member what was removed and why (recommended: a short email, by hand at first)?
  - Is "someone under 16" a reason?

### WP-26 Name rules and a shared text rule. **Postponed with open sign-up (issue #331)** · M · normal (Opus review)
- **Revision 3:** not urgent while every member has an invite code, but a cheap guard against impersonation, and the
  base for WP-12 and WP-16. Before sign-up opens it is required (#331).
- **Why:** a name is free text written through the public auth API (§2.2); the client's `cleanName` is not a
  guard. Bio (WP-16), visible Collection names (WP-12) and links (WP-22) need the same rule.
- **Scope:**
  - **`private.public_text_ok(text, max_len, allow_urls)`**, one SQL helper:
    - trims and collapses whitespace;
    - refuses control, bidi-override and zero-width characters;
    - refuses URLs, e-mail addresses and phone-number patterns unless allowed;
    - checks the length.
    - Unit-tested in pgTAP with EN and DE examples.
  - **Names:**
    - A `BEFORE UPDATE OF raw_user_meta_data` trigger on `auth.users` refuses a *changed* name that breaks the rule
      or is reserved. Reserved means the app's names (Libellus, BetterReads), "admin", "support", "team",
      "moderator", "official" and the owner's name, compared case- and accent-folded.
    - The trigger acts only when the name changes, so a sign-in, which also updates `auth.users`, never fails on an
      old name.
    - `private.member_name` also sanitizes on read, so old names display safely.
  - **Client:** `cleanName` mirrors the rule; the name sheet shows the refusal (`account.nameError.*`).
  - WP-03's shortcut uses the same sheet, so nothing else changes.
- **German:** `account.nameError.reserved` ("This name is reserved." / "Dieser Name ist reserviert."),
  `account.nameError.invalid`.
- **Tests:**
  - pgTAP: the helper; the trigger refuses reserved and bidi names on change and lets a sign-in through for a
    legacy name.
  - Vitest: `cleanName`.
- **Acceptance:**
  - Setting "BetterReads Support" or a name with U+202E is refused, both through the app and through a direct
    `auth.updateUser`.
  - Existing members still sign in.
  - The helper is ready for WP-12, WP-16 and WP-22.
- **Open questions:**
  - The reserved list?
  - Should names be unique (recommended: no)?

### WP-27 Launch texts: privacy notice, community rules, moderation runbook. **Postponed (issue #331)** · S–M · Sonnet (the owner reviews)
- **Scope (docs and legal texts only):**
  - **Privacy notice** (`web/app/legal/privacy.ts`, EN and DE, with a new version date):
    - drop "run as an invite-only beta" (`:13`);
    - invite code becomes optional (`:32`);
    - the waitlist lines (`:37`, `:55`, `:111`) as WP-24 decides;
    - add **reports**: what is stored, who reads it, how long it is kept, and the legal basis (legitimate interest /
      legal obligation);
    - the age line consistent with the sign-up check;
    - the captcha provider (Cloudflare Turnstile) as a processor.
  - **Community rules:** a short page (EN and DE, the same `legal/` machinery). What is not allowed (impersonation,
    harassment, spam, sexual content, minors), what the owner can do (clear a name, photo or review; suspend), and
    how to report. Linked from sign-up and from the report sheet.
  - **`docs/OPERATIONS.md`, a moderation runbook:**
    - read reports;
    - each owner action;
    - ban and unban in the Supabase dashboard;
    - how to tell a member why;
    - the incident switch back to invite-only (WP-24);
    - the Supabase and Resend usage thresholds, and when to upgrade.
  - **`docs/legal-checklist.md`:** the DSA notice-and-action item, the age decision and the new processor.
  - `SPEC.md`: Access and the out-of-scope list (`:24` lists "open sign-up" as out of scope).
- **Ordering:** after the BetterReads rename has merged, or it does the legal-text name swap itself.
  `tests/legal.test.ts` must stay green (no placeholders).
- **Acceptance:**
  - No "invite-only" claim is left in user-facing legal text.
  - Reports and the captcha are in the notice in both languages.
  - The community rules page exists and is linked.
  - The runbook covers every owner action WP-25 adds.
- **Open questions:** Is a postal address needed before sign-up opens (`docs/legal-checklist.md:17`
  recommends it)? How long are reports kept (recommended: 12 months after handling)?

---

### WP-28 Genres and tags (#344, #358). P2 · L, several PRs · normal (Opus for the label resolver) · new in revision 4
- **Source:** `docs/plans/genres.md` on draft PR #357. It covers the data model (vocabulary, raw signals, `book_labels`,
  `entry_labels`, "the twenty" for the chart), label quality (a resolver, block list, trust and threshold, measured on
  58 sample books and the 194 Catalogue Books), the member experience, costs and an 8-PR build plan.
- **Gate:** the owner answers the 16 open questions in #357 §7. Nothing starts before that.
- **Hotspots:**
  - the genre components (`components/book/Genres.vue`, `GenreSheet.vue`, `components/profile/Genres.vue`);
  - `stores/genres.ts`, `data/enrich/*`;
  - the Library filter (`components/library/FilterSheet.vue`), which collides with WP-15;
  - the enrich function.
- **Issue drafts:** none here; #357's own build plan is the breakdown.

### WP-29 Export your data (#170). P2 · M · normal · new in revision 4
- **Scope:**
  - A Profile → Account row "Export your data" that downloads two files:
    - a BetterReads JSON with everything she owns: Library, reads, reviews, Collections, profile links, link
      templates, settings;
    - a Goodreads-format CSV, so she can take her reading elsewhere.
  - Built on the device from her own rows (RLS), so no new SQL beyond what the repositories read.
- **Files:**
  - `data/export/*` (beside the Regal export: `memberLibrary.ts`);
  - `components/profile/Account.vue`;
  - locales, parity, and the privacy notice ("you can export your data").
- **Tests:** Vitest for both formats (round-trip the CSV through the app's own Goodreads importer).
- **Acceptance:**
  - The JSON validates against a documented shape.
  - The CSV re-imports through the app's own Goodreads import with the same books, reads and ratings.
  - It works offline from the device copy, or says what it lacks.
- **Open questions:** Include reviews and notes by default? JSON only first?

## 8. Waves, hotspots and the critical path

**Waves** (revision 4; they count from `origin/main` `65998068`, release 1.30.0). Packages in one wave touch disjoint
files, or the same file in disjoint hunks (marked ≈). **One Opus worker at a time.**

| Wave | Packages | Opus slot |
|---|---|---|
| 1 | WP-02 check (the owner's phone; no worker unless the Stack fails), WP-15, WP-13, WP-29, WP-20 (≈ locales and `docs/parity.md`, different sections) | WP-02 fix, only if needed |
| 2 | WP-14 (← WP-13); WP-20 if not in wave 1 | free; keep it for WP-17 |
| 3 | WP-17 (← WP-14; re-audit the SQL first); WP-28 PR 1 once #357 is answered (≈ `FilterSheet.vue` with WP-15, which merged in wave 1) | **WP-17** |
| 4 | WP-18 (← WP-17, WP-15); WP-11 after WP-17 frees the Opus slot | WP-11 |
| 5 | WP-19 (← WP-18); WP-12 (← WP-11, WP-14) | none |
| later | WP-16 (after #331 opens, or with its own minimal rule), WP-30 (#172), WP-31 (#259) | none |
| parked | WP-21, WP-23 | none |
| postponed (#331) | WP-24, WP-25, WP-26, WP-27 | none |

**Critical paths:**
- **Product:** WP-13 → WP-14 → WP-17 → WP-18 → WP-19, five waves. The chain is set by `sync_write` (WP-14, then
  WP-17) and the status model.
- **Short and parallel:** WP-15, WP-20 and WP-29 each ship in one wave.
- **Open sign-up (whenever the owner opens #331):** WP-24 ∥ WP-25 ∥ WP-27 ∥ WP-26, then a check of WP-12, WP-16,
  WP-21 and WP-22 against the report reasons and the text rule.

**Hotspots: who touches what today and in the plan:**

| File / function | Open work (PRs, worktrees) | Plan packages |
|---|---|---|
| `web/app/components/auth/{Frame,Mark}.vue`, `design/tokens.json`, `docs/DESIGN.md`, `docs/MOTION.md` | PR #457 (way-in lamp) | none (WP-24 later touches sign-up) |
| `web/app/assets/css/main.css`, `web/nuxt.config.ts`, launch-takeover plugin, `web/public/*` icons | worktree `boot-screen-revert` | WP-02 only if the Stack fix needs `main.css` |
| `pages/friends/*`, `components/friends/PrivacySheet.vue`, the social migrations | worktree `libellus-friends-visibility` (no commits yet) | WP-11, WP-12: ask first |
| `pages/library.vue`, `components/library/*`, `data/libraryView.ts`, `stores/libraryView.ts` | none | WP-15, then WP-18, WP-28 (filter) |
| `components/collections/*`, `stores/collections.ts`, `data/collections.ts`, `pages/collections/*` | none | WP-13, WP-14, WP-12, (WP-21) |
| `data/stats.ts`, `stores/stats.ts`, `pages/profile/index.vue`, `components/profile/Chart*.vue` | none | WP-20, WP-18 (head counts), WP-28 (genre chart) |
| `data/import*`, `supabase/functions/import-job`, `import_books` / import-job SQL | none (the import work has merged) | WP-17 (status literals), WP-19 |
| `data/export/*` | none | WP-29 |
| `data/auth.ts`, `stores/shelf.ts` | none (the sign-in/shelf-retry work merged, 1.18.0 #332) | WP-24, WP-26 (postponed) |
| SQL `sync_write` | none | WP-14, then WP-17 |
| SQL `member_profile`, `member_reading_record`, `public_reading_page`, `feed`, `circle_reading`, `book_readers` | none | WP-17 (re-audit), WP-16, WP-11 (only with a section switch) |
| `@fabkho/ui` (the `fabkho/ui` repo: Sheet, Row, Segmented, SeeAll) | other repo | any package that needs a new UI part: change it there or wrap it in the app |
| `web/i18n/locales/{en,de}.json`, `docs/parity.md` | everyone | all (keys in each feature's own block; rebase) |

---

## 9. Open questions for the owner (open packages only)

- **WP-02:** did the row and the Stack scroll on your iPhone after 1.17.0? Pin Regal to a commit?
- **WP-11:** private by default; a Privacy section switch too; on the public reading page ever?
- **WP-12:** a page or a sheet for her Collection; where on her profile?
- **WP-14:** the mode per device or per account; a new Collection on top or at the end?
- **WP-15:** per status or global; the Collection page too; a date or a duration?
- **WP-16:** wait for #331, or now with its own minimal rule; length; line breaks; who sees it; the German label?
- **WP-17/18:** progress resumes; followers see paused under Currently reading; no feed event; add straight as On
  hold; a section or a segment; counted in the Library line; on the shelf? Staging (#177) first?
- **WP-19:** which shelf names? Map Hardcover's Paused straight to On hold?
- **WP-20:** its place on the Profile (beside or instead of Reading days); the custom range's maximum?
- **WP-21:** do it at all?
- **WP-23:** build the self-only counts now? Keep public counts parked?
- **WP-28:** the 16 questions in #357 §7.
- **WP-29:** include reviews and notes by default; JSON first, CSV later?
- **#305, #361, #213:** yes or no before they become packages.
- **#331 (WP-24–27):** as in the issue (Turnstile, the email limit, invite codes as a perk, moderation, legal).

---

## Appendix: the backlog as received

Quoted from the owner's list (`/tmp/backlog/backlog.md`, grouped by Gemini; the grouping is not used above).

1. Stats label on other members' profiles: "Authors You Return To" is wrong for a stranger's profile ("You"). Use the name dynamically ("Authors [Name] Returns To") or a neutral label ("Most Read Authors" / "Frequently Read Authors").
2. Public Collections: on another member's profile, show her public collections.
3. Inline name editing (own profile only): the profile name is tappable as a direct-edit shortcut.
4. Bio / slogan: a short text field under the profile name.
5. Social links and external profiles: Instagram, TikTok, YouTube links and links to external book-tracking platforms.
6. Private collections: mark single collections private/hidden (not visible even on a public profile or to followers).
7. Manual sorting: drag and drop to order collections individually.
8. Custom cover image: override the automatic four-cover grid with an uploaded image.
9. Optional sort filters inside a collection: title, author, publication date, date added ("when added").
10. Quick-add shortcut: a clearly visible plus button on the collection page that opens the book search directly.
11. Profile statistic "by month / by week": a. remove the button/link to the Year-in-Review page at the chart on the profile page; b. toggle between monthly and weekly view; c. a second trigger/navigator to move between the individual weeks/months of the current range.
12. Interactive "Authors..." section: tapping a row/author opens a bottom sheet with all of that author's books.
13. New cross-book reading progress widget: summary chart of pages read across all books, with filters (week, month, custom date picker).
14. Interactive "Average rating" statistic: tapping it opens a bottom sheet of all unrated books to rate them directly.
15. Interactive "Ratings" statistic (bar charts): make tappable to show the matching / the unrated books in a bottom sheet.
16. Interactive "Genre" statistic (bar charts): no redirect to the Library any more; open a bottom sheet with all books of the chosen genre.
17. Performance and pagination: in those bottom sheets from about 25-50 books on, paginate / lazy load with infinite scroll.
18. Feed row redesign: make the activity rows in the Friends feed more compact so more rows fit on screen.
19. Future roadmap (long term): follower system and social counts (later phases, once the user base grows).
20. Layout toggle: switch between grid view and list view on the collection list and the status lists (except Currently Reading).
21. Duration indicator: show "Reading since [date/period]" in all grid and list views.
22. Loading animation: UI feedback / loading animation when switching or applying existing filters.
23. New reading status "On Hold": a separate On Hold list for paused books (clearly separate from DNF / Did Not Finish).
24. Month dividers: in the calendar-like view, make the divider lines between months visually stronger.
25. "The Favorite" card: redesign as a connected row with all 5-star books of the year.
26. iOS scroll bug (3D vertical/horizontal stack): on iOS the 3D vertical/horizontal stack is broken and cannot be scrolled (works fine on Android).
27. Goodreads import: verify/ensure that the import explicitly loads and stores HIGH-RESOLUTION cover images for the book covers.
