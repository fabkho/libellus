# Backlog execution plan: 27 items, 27 work packages (revision 3: open sign-up postponed)

**DRAFT, not merged.** Exactly one GitHub issue has been created from this plan:
[#331](https://github.com/fabkho/libellus/issues/331), the postponed open sign-up bundle. This file is a plan,
not a spec. It checks the owner's backlog of 27 items (grouped by Gemini; that grouping was not used) against the
code on `origin/main` at `2b3faf91` (release 1.14.0, 2026-10-11). It then regroups the items into work packages.
Each package is one worker and one PR, sized to merge on its own. Issue drafts, one per package, are in
[`backlog-issues/`](backlog-issues/), ready for `gh issue create` once the owner decides.

How the items were checked: by reading code, migrations, tests and `docs/parity.md`, and by reading the Regal
repo (`fabkho/regal`, `origin/main` `3376fce`) for #26. Nothing was run and no screenshots were taken. Line
numbers are from `2b3faf91`. Item numbers **#1–#27** are the owner's, from the list quoted in the
[appendix](#appendix-the-backlog-as-received).

**Revisions:**
- **Revision 2** expected a public launch the following week and added four packages that open sign-up safely
  (WP-24 to WP-27).
- **Revision 3 (2026-10-12): the owner postponed open sign-up.** The app stays invite-code only.
  - WP-24, WP-25 and WP-27, with WP-26's server rules, are bundled in issue
    [#331](https://github.com/fabkho/libellus/issues/331), status *postponed; do not start until the owner opens it*.
  - The facts behind them stay in §2: what depends on invite-only today, the abuse cases, the 30-mails-an-hour
    project limit. They are what must be true **before** sign-up opens, not what has to happen now.

**Shipped since revision 1** (on `origin/main` at `1127a7df`, release 1.17.0):
- WP-01 (#309)
- WP-03 (#310)
- WP-04 (#314, #318)
- WP-05 (#322)
- WP-09 (#321)
- WP-10 (#313)
- The BetterReads rename (#311)
- The Reado import (#294), which unblocks WP-19's Reado part

**For WP-02:** Regal merged "iOS: the row scrolls natively under a finger, the Stack keeps its drag" (regal#84,
`22276c9`). The row is fixed in code. The Stack still needs the owner's iPhone to say whether it scrolls.

## Now vs before open sign-up

**Worth starting now** (ranked; §8 has the waves):
1. **WP-02 follow-up**: check iOS on a device after regal#84, and fix the Stack only if it still does not scroll.
2. **WP-06**: tappable stats (an author's, a genre's, the unrated books).
3. **WP-22**: social links. The owner wants them. Handles are validated per platform, the app builds the URLs, and
   nothing is free text.
4. **WP-15**: grid or list in the Library.
5. **WP-13 → WP-14**: Collections in her own order.
6. **WP-07 / WP-08**: rate from the sheet; by week (both after WP-06).
7. **WP-17 → WP-18 → WP-19**: On Hold.

**Safe while invite-only; revisit before open sign-up.** These show member-written content to others. While every
member came in on an invite code, the risk is small, so they keep their order. Each must have its report reason
(WP-25) and the text rule (WP-26) before sign-up opens (#331):
- WP-12 (visible Collections).
- WP-16 (bio).
- WP-22 (social links).
- WP-21 (Collection covers; parked anyway).

**Postponed with open sign-up (#331):** WP-24, WP-25, WP-27. WP-26 keeps its place in the plan (P3, a guard
against impersonation that is worth having even invite-only) but waits for the running sign-in worker to release
`web/app/data/auth.ts`.

**Running elsewhere: do not collide.**
- The cover and import worker owns `web/app/data/import*`, the cover code (`data/covers.ts`, `data/coverFill.ts`)
  and `data/bookImport.ts`, with open PRs #327, #328 and #329.
- A sign-in and shelf-retry worker owns `web/app/data/auth.ts`, the sign-in screens and `stores/shelf.ts`.
- What that means here:
  - WP-19 (importers) and WP-17's `import_books` changes wait for the import work to settle.
  - WP-26 waits for `auth.ts`.

---

## 1. Summary table

Tiers: **P0** bugs · **P1** easy wins · **P2** medium · **P3** hard · **P4** refactor, long-term or parked ·
**postponed** = waits for the owner to open sign-up (#331).
GitHub labels: **priority:high** = P0–P2, **priority:low** = P3–P4 and postponed.
Models: **Opus** = `anthropic/claude-opus-5-5` (debugging, the sign-up gate, a design-critical DB model) · **Sonnet** =
the default · **Haiku** = mechanical (DeepSeek works too).
"Wave" counts from now (revision 3); shipped packages show their PR.

| ID | Title | Items | Tier | Size | Model | Depends on | Wave |
|---|---|---|---|---|---|---|---|
| WP-01 | Profile quick fixes: a member's "Authors" label, no "in review" pill at the chart, stronger month rules | #1, #11a, #24 | P0 | S | Haiku | none | **shipped #309** |
| WP-02 | iOS: the shelf's row and Stack do not scroll (Regal) | #26 | P0 | M | Opus | none | **row fixed (regal#84); device check and the Stack: 1** |
| WP-03 | Tap your name on the Profile to edit it | #3 | P1 | S | Sonnet | none | **shipped #310** |
| WP-04 | Compact rows in the Friends feed | #18 | P1 | S–M | Sonnet | none | **shipped #314, #318** |
| WP-05 | One paginated books sheet for the stats | #17 (+ dedup refactor) | P1 | M | Sonnet | WP-01 | **shipped #322** |
| WP-06 | Tappable stats: an author's books, a genre's books, the unrated books | #12, #16, #15, #14 (part 1) | P1 | M | Sonnet | WP-05 ✓ | 1 |
| WP-07 | Rate books straight from the unrated sheet | #14 (part 2) | P2 | M | Sonnet | WP-06 | 2 |
| WP-08 | Chart by month or by week, with a range navigator | #11b, #11c | P2 | M | Sonnet | WP-06 | 2 |
| WP-09 | Year in review: every five-star book, not one favourite | #25 | P2 | M | Sonnet | WP-01 | **shipped #321** |
| WP-10 | Collection page: a + to add from search, and sorting | #10, #9 | P2 | M | Sonnet | none | **shipped #313** |
| WP-11 | Collection visibility, database (private by default, opt-in per Collection) | #6, #2 | P3 | L | Opus | none (no section switch: out of the SQL chain) | 3 (or any wave as filler) |
| WP-12 | Collection visibility, app: the switch, and her collections on her profile (**safe while invite-only; revisit before open sign-up**) | #6, #2 | P3 | M–L | Sonnet | WP-11, WP-26 | 4 |
| WP-13 | Refactor: a reusable drag-to-reorder list (from `EntryList.vue`) | enabler for #7 | P4 | M | Sonnet | WP-10 ✓ | 1 |
| WP-14 | Manual order of Collections next to "last edited" (sort mode) | #7 | P3 | L | Sonnet | WP-13 (WP-12 rebases onto it) | 2 |
| WP-15 | Grid or list in the Library, with each status's date line | #20, #21 | P3 | L | Sonnet | WP-10 ✓ | 1 |
| WP-16 | A short bio under the name (**safe while invite-only; revisit before open sign-up**) | #4 | P3 | M | Sonnet | WP-03 ✓, WP-26; after WP-17 (`member_profile`) | 4 |
| WP-17 | On Hold, database: a paused open session | #23 | P3 | L | Opus | WP-14 (`sync_write`); `import_books` after the import work settles | 3 |
| WP-18 | On Hold, app: every screen that knows a status | #23 | P3 | L | Sonnet | WP-17, WP-15 | 4 |
| WP-19 | On Hold, importers (Goodreads, Hardcover, Fable, Reado) | #23 | P3 | S–M | Haiku | WP-18, the import worker's PRs | 5 |
| WP-20 | Pages read across books: a chart with week, month and custom ranges | #13 | P3 | L | Sonnet | WP-08 | 3 |
| WP-21 | A collection's own cover image (**parked; safe only while invite-only; revisit before open sign-up**) | #8 | P4 | L | Sonnet | WP-12, WP-14, WP-25 | parked |
| WP-22 | Social links: allow-listed platforms, handles only, visibility setting (owner decision: wanted; **safe while invite-only; revisit before open sign-up**) | #5 | P2 | M | Sonnet | none now (handles are regex-checked, no free text); the "links" report reason comes with WP-25 | 1 |
| WP-23 | Follower counts (parked; a self-only variant is offered) | #19 | P4 | S (self-only) / M | Sonnet | none | parked |
| WP-24 | Open sign-up safely: `signup_mode` switch (default `invite`), captcha, email budget, photo cap, age line | open sign-up | **postponed (#331)** | M | Opus | the owner opens #331 | postponed |
| WP-25 | Report a member (name, photo, reviews) and the owner's minimal handling | open sign-up (#2, #4, #5, #8 prerequisite) | **postponed (#331)** | M | Sonnet (Opus review of the SQL) | the owner opens #331 | postponed |
| WP-26 | Name rules on the server and a shared text rule for public content (also in #331) | #3 guard; #4, #2, #5 prerequisite | P3 | M | Sonnet (Opus review: an `auth.users` trigger) | the sign-in worker's `auth.ts` work merged | 2–3 |
| WP-27 | Launch texts: privacy notice, community rules, moderation runbook | open sign-up | **postponed (#331)** | S–M | Sonnet (the owner reviews the legal text) | the owner opens #331 | postponed |

**Counts:**
- Shipped: 6 (WP-01, 03, 04, 05, 09, 10), and WP-02 in part.
- Open: P0 1 (WP-02 follow-up) · P1 1 · P2 3 · P3 10 · P4 3 (one enabler, two parked).
- Postponed with #331: 3 (WP-24, 25, 27).
- Total: 27 packages.

**What changed from revision 2:**
- WP-24, WP-25 and WP-27 are **postponed** (#331).
- WP-26 drops from P1 to P3. It is in #331 as well, but it can land earlier as a guard.
- WP-12, WP-16, WP-21 and WP-22 no longer wait for the postponed packages. They carry the condition *safe while
  invite-only; revisit before open sign-up* instead.
- WP-22 can start now: its input is handles validated by format, not free text.
- WP-14 no longer waits for WP-12; WP-12 rebases onto it instead.
- WP-17 moves ahead of WP-16 in the `member_profile` chain.

**Items with no package of their own:**
- **#22** (a loading animation on filters): recommended **not** to do; see §4.
- **#27** (high-resolution Goodreads covers): **already true on `main`**; what is left belonged to the import
  cover work (merged as #315 and #326), see §4.
- **#15** is mostly shipped; its remainder rides in WP-06.
- **#21** is mostly shipped; its remainder rides in WP-15.

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

### WP-01 Profile quick fixes (#1, #11a, #24). P0 · S · Haiku · wave 1
- **Why grouped:** three one-line kinds of change in the same profile and year files. #1 is the bug; #11a and #24
  ride along because they touch the same pages and are minutes each.
- **Files:**
  - `components/profile/Authors.vue` (a `name` prop).
  - `pages/friends/[member]/index.vue:326` (pass the name) and `:312-314` (remove the pill).
  - `pages/friends/[member]/[year].vue:138`.
  - `pages/profile/index.vue:174-176` (remove the pill).
  - `components/profile/MonthBooks.vue:118-120` (`--color-hairline` → `--color-hairline-strong`).
  - Both locale files and `docs/parity.md` (Profile, A member's profile, Year in review: remove `profile.inReview`
    and `member.inReview` from the By-month description and the IDs).
- **Migration:** no.
- **German:** `profile.authors.titleOf` ("Autoren, zu denen {name} zurückkehrt"), `profile.authors.titleNeutral`
  ("Meistgelesene Autoren"). If `profile.inReview` is unused afterwards, delete it from both
  (`tests/i18n-runtime-only.test.ts`).
- **Tests:** i18n parity; the existing stats and member-profile tests; look at 390 px in DE.
- **Acceptance:**
  - A member's profile and year show "Authors {name} returns to"; your own is unchanged.
  - With no name, the neutral title shows.
  - No "in review" pill beside By month on either profile.
  - Year cards and (under All) year columns still open a year.
  - Month rules visibly stronger in light, dark and sepia.
  - Parity updated.
- **Open questions:** named or neutral label? Remove the pill on member profiles too (recommended)? A stronger
  colour only, or a 1 px rule?

### WP-02 iOS shelf scrolling (#26). P0 · M · Opus · wave 1 · **in the Regal repo**
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

### WP-03 Tap the name to edit it (#3). P1 · S · Sonnet · wave 1 (running; revision 2: safe as is, the server-side name rule is WP-26)
- **Files:**
  - `components/profile/Hero.vue:57`: a button inside the `h1`, with the `profile.title` test ID kept.
  - `components/profile/Account.vue:162,225`: share the open state, or move `ShellNameSheet` up.
  - `pages/profile/index.vue`: wire it like `@photo`.
  - Locales; parity (Profile, Member name).
- **Migration:** no.
- **German:** `profile.editName` ("Edit your name" / "Namen ändern"), the button's accessible name.
- **Tests:** none new (UI only); keyboard and 390 px by hand.
- **Acceptance:**
  - Tapping the name opens the same name sheet as the Account row; saving updates the hero.
  - Focus returns to the name.
  - 44 px target.
  - A member's name on her profile is not a button.
  - Offline behaves like the Account row.
- **Open question:** a visible pencil next to the name, or none?

### WP-04 Compact feed rows (#18). P1 · S–M · Sonnet · wave 1
- **Files:** `components/friends/FeedRow.vue:80`, `FeedBatch.vue`, `RowPlaceholder.vue` (`kind="feed"`, the same
  height), `pages/friends/index.vue`, `RowActions.vue`. Home's `compact` variant stays as it is.
- **Approach:**
  - Two variants in the PR, as screenshots at 390 × 844, light and dark, for the owner to pick.
  - Variant A: cover `sm` (40 px), title and author on one line, review clamped to two lines.
  - Variant B: a cover between the two sizes (a new token), review at three lines.
  - Measure rows per screen before and after.
- **Migration:** no. **German:** none expected.
- **Tests:** `tests/feed-view.test.ts` unchanged; `e2e/friends.spec.ts` locally.
- **Acceptance:**
  - At least 1.5× as many rows per 390 × 844 screen.
  - No layout shift when placeholders turn into rows.
  - More still unfolds a review.
  - The heart, Want to read and every row action keep a 44 px target.
  - The cover flight still lands.
- **Open questions:** how compact? Keep the heart and Want to read on every row?

### WP-05 One paginated books sheet (#17 + refactor). P1 · M · Sonnet · wave 2 (after WP-01)
- **Why P1 although partly a refactor:** it is the base of four easy wins (#12, #14, #15, #16) and removes a
  four-way copy. The owner's "refactors last" does not fit an enabler.
- **Files:**
  - A new `composables/useStatsSheet.ts`.
  - `stores/stats.ts` (`ProfileSheet` union at `:7-11`, `keptSheet.shown`).
  - `components/profile/ReadsSheet.vue:24`.
  - `composables/useSheetRestore.ts`, `useProfileSheet.ts`.
  - `pages/profile/index.vue:111-142`, `pages/profile/[year].vue`, `pages/friends/[member]/index.vue`,
    `pages/friends/[member]/[year].vue`.
  - `components/home/TallySheet.vue` (also uses `ProfileReadsSheet`; check).
- **Migration:** no.
- **German:** `profile.sheet.showMore` ("Show {count} more" / "{count} weitere anzeigen").
- **Tests:** Vitest for the composable's pure mapping and the paging helper (`tests/stats.test.ts` or a new file).
- **Acceptance:**
  - A sheet with 120 reads shows 30 rows; Show more adds 30.
  - Opening a book and coming Back restores the sheet with the same count and scroll.
  - The four pages have no `sheetTitle` / `sheetReads` switch of their own.
  - Sheets under 30 rows look exactly as before.
- **Open questions:** page size (25, 30 or 50)? A button, or auto-load near the end (with a button as fallback)?

### WP-06 Tappable stats (#12, #16, #15, #14 part 1). P1 · M · Sonnet · wave 3 (after WP-05)
- **Files:**
  - `components/profile/Authors.vue`: rows become buttons, keeping the list semantics.
  - `Genres.vue`: no more `navigateTo('/library')` in the pick handler.
  - `Figures.vue`: "N not rated yet" becomes a button, as the Pages line is.
  - `Ratings.vue`: "N not yet" becomes a button.
  - `data/stats.ts`: `readsByAuthor`, `readsOfGenre(reads, year, ofEntry)`, `readsUnrated`.
  - `stores/stats.ts` (kinds), the pages' pick handlers, locales, parity (Profile, Genres, Year in review, A member's
    profile).
- **Migration:** no.
- **German:** `profile.sheet.author` ("{name} · {year}"), `profile.sheet.genre`, `profile.sheet.unrated` ("Not
  rated yet" / "Noch nicht bewertet"), `profile.figures.unratedOpen` and `profile.ratings.notYetOpen` (accessible
  names), `genre.stats.inLibrary` ("Show in Library" / "In der Bibliothek zeigen").
- **Tests:** Vitest for the three selectors (re-reads count, abandoned excluded, the year filter, an unknown genre).
- **Acceptance:**
  - An author row opens a sheet of that author's reads, with an author-page link when a key is known; this works on
    member profiles too.
  - A genre row opens a sheet, with "Show in Library" in its foot.
  - "N not rated yet" and "N not yet" open the unrated sheet.
  - On a member who hides ratings, nothing about ratings is tappable.
  - Back restores each sheet.
- **Open questions:** author row → sheet (recommended) or → the author page? Keep "Show in Library"?

### WP-07 Rate from the unrated sheet (#14 part 2). P2 · M · Sonnet · wave 4
- **Files:** `components/profile/ReadRow.vue` or `ReadsSheet.vue` (row action slot); a rating-only write
  (`rateSession(entryId, sessionId, rating)`) in `data/library.ts` / `stores/history.ts` that reuses the
  `updateSession` path and the outbox; locales; parity.
- **Migration:** no (check that `update_session` accepts a rating-only edit under `rating_when_finished`).
- **German:** `profile.sheet.rateLabel` ("Rate {title}"), `profile.sheet.rated`.
- **Tests:** a Vitest repository test against the local stack (`tests/` conventions); offline queueing.
- **Acceptance:**
  - Three books rated in a row without leaving the sheet.
  - A rated row stays until the sheet closes, marked rated, so nothing jumps under the finger.
  - Offline, the ratings queue and sync.
  - The figures are right after closing.
  - Each rating control is named by its book.
- **Open questions:** stars inline on each row, or a tap that opens a small rating sheet? Rating only, or a review
  too (recommended: rating only)?

### WP-08 By month or by week, with a navigator (#11b, #11c). P2 · M · Sonnet · wave 4
- **Files:**
  - `components/profile/Columns.vue`.
  - `data/stats.ts` (`weeksOf`, ISO weeks, Monday first like `Days.vue`).
  - `stores/stats.ts` (mode and offset, kept across a trip to a book).
  - `pages/profile/index.vue`, and the member page if wanted.
  - The `week` sheet kind; locales; parity.
- **Recommended shape:**
  - When a year is picked, a compact segmented control "Months · Weeks" by the chart title.
  - Weeks show 13 columns (a quarter) with ‹ › stepping through the year.
  - Months keep 12 columns, and ‹ › steps between years, kept in step with the pills.
  - Under All, only years.
- **Migration:** no.
- **German:** `profile.byWeek` ("By week" / "Nach Woche"), `profile.chartMode.*`, `profile.prevRange` and
  `profile.nextRange` (accessible names), `profile.sheet.week` ("Week of {date}").
- **Tests:** Vitest `weeksOf` (a week that crosses the year, week 53, a read without an end date).
- **Acceptance:**
  - Toggling switches the bars without moving anything under the chart (the same height, as today).
  - ‹ › moves through ranges and stops at the ends.
  - A week's column opens its sheet.
  - The state survives a trip to a book and back.
  - Accessible names on every control.
- **Open questions:** what range of weeks (a quarter, the last 12, the whole year in a scroll)? On member profiles
  too? Remember the mode?

### WP-09 Every five-star book of the year (#25). P2 · M · Sonnet · wave 2 (after WP-01)
- **Files:** `data/stats.ts` (`favourites`: rating exactly 20 quarters, newest first; fall back to today's single
  favourite when none), `components/profile/Favourite.vue` (a sideways row of covers, lit by the first; a skeleton),
  `pages/profile/[year].vue:130`, `pages/friends/[member]/[year].vue:127`. `YearCards.vue` keeps one favourite.
  Locales, parity.
- **Migration:** no.
- **German:** `profile.year.favourites` ("Five stars" / "Fünf Sterne") with a count.
- **Tests:** Vitest `favourites` (4.75 excluded, the tie order, the fallback).
- **Acceptance:**
  - A year with four 5.00 reads shows four covers in one row, each a link named by its title.
  - A year with none shows the top-rated one as today.
  - A member's Manual books do not open.
  - The `#favourite` anchor still works.
- **Open questions:** exactly 5.00, or ≥ 4.75? A row that scrolls sideways, or a wrapped grid? The title?

### WP-10 Collection page: + add, and sort (#10, #9). P2 · M · Sonnet · wave 1
- **Files:**
  - `pages/collections/[id].vue` (a + in the top bar, a sort pill).
  - `stores/search.ts` (a `target: { collection }` mode, like `linking`) and `components/search/{Results,ResultRow}.vue`
    (the add action becomes "Add to {name}"; already-on rows checked).
  - `components/collections/EntryList.vue` (drag and grips disabled while sorted).
  - `data/collections.ts:219` (read `collection_entries.added_at`).
  - `components/library/SortSheet.vue` (a `sorts` prop).
  - Locales; parity (Collection, Search).
- **Migration:** no.
- **German:** `collection.add` ("Add books" / "Bücher hinzufügen"), `collection.addTo`, `collection.sort.*` (Your
  order · Title · Author · Year · Date added), `collection.sortedHint`; update `collection.empty`.
- **Tests:** Vitest for the sort function and for `added_at` in the repository (`tests/collections.test.ts`).
- **Acceptance:**
  - + opens search aimed at this Collection; adding puts the Book on it (and on Want to read if new, said in the UI).
  - Already-on Books show a check.
  - Sorting reorders the view only; "Your order" brings back drag.
  - The saved order is untouched.
  - With the keyboard, a disabled grip is not focusable while sorted.
- **Open questions:** remember the sort per Collection? Which "date added" (to the Collection, recommended, or to
  the Library)?

### WP-11 Collection visibility, database (#6, #2). P3 · L · Opus · wave 1 (filler; the SQL chain head)
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

### WP-12 Collection visibility, app (#6, #2). P3 · M–L · Sonnet · wave 4 (after WP-11, WP-14, WP-26) · **safe while invite-only; revisit before open sign-up (#331)**
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

### WP-13 Refactor: a reusable reorder list. P4 · M · Sonnet · wave 2 (after WP-10)
- **Scope:** move the pointer, hold, keyboard and live-region logic of `components/collections/EntryList.vue` into
  `composables/useReorderList.ts`. There is **no behaviour change**.
- **Tests:** Vitest for the index maths and the keyboard moves.
- **Acceptance:** the entries reorder exactly as before (touch hold of 350 ms, grip drag, arrows, Home and End,
  announcements); parity unchanged.
- **Open questions:** none.

### WP-14 Manual order of Collections (#7). P3 · L · Sonnet · wave 4 (after WP-12, WP-13)
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

### WP-15 Grid or list in the Library (#20, #21). P3 · L · Sonnet · wave 2 (after WP-10)
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

### WP-16 A short bio (#4). P3 · M · Sonnet · wave 4 (after WP-26; after WP-17 in the `member_profile` chain) · **safe while invite-only; revisit before open sign-up (#331)**
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

### WP-17 On Hold, database (#23). P3 · L · Opus · wave 5 (after WP-11, WP-14, WP-16)
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

### WP-18 On Hold, app (#23). P3 · L · Sonnet (Opus review) · wave 6 (after WP-17, WP-15)
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

### WP-19 On Hold, importers (#23). P3 · S–M · Haiku · wave 7 (after WP-18, PR #294)
- **Files:** `data/import/goodreads.ts:80` (`on-hold`, `paused`, `on hold` shelves become a paused open read),
  `hardcover.ts` (its Paused status, if it has one), `fable.ts`, `rows.ts`, `components/import/Counts.vue`, the Reado
  mapping from #294, `import_books` (if WP-17 has not already taught it).
- **Tests:** Vitest per importer with fixture rows.
- **Acceptance:** a Goodreads file with an `on-hold` exclusive shelf imports those Books as paused, not as a
  Collection; the counts on the import page show them.
- **Open question:** which shelf names count (in English and German)?

### WP-20 Pages read across books (#13). P3 · L · Sonnet · wave 5 (after WP-08)
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

### WP-21 A Collection's own cover (#8). P4 · L · Sonnet · **parked unless members ask** (after WP-12, WP-14, WP-25) · safe only while invite-only; revisit before open sign-up (#331)
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

### WP-22 Social links (#5). P2 · M · Sonnet · wave 1 (no hard dependency now) · owner decision: wanted · **safe while invite-only; revisit before open sign-up (#331)**
- **Revision 3:** with sign-up postponed, WP-22 no longer waits for WP-25 or WP-27. It stores no free text (handles
  are regex-checked per platform), so it does not need WP-26 either. It adds its own privacy-notice line. The "links"
  report reason and the owner action come with WP-25 when #331 opens.
- **Why this shape:** links can reach strangers (public accounts now, everyone once sign-up opens), and a free URL field is a phishing and spam
  tool. So members store only a **validated handle or canonical ID per allow-listed platform**, and the app builds
  every outgoing URL itself.
- **Platforms (owner's list).** The formats are starting points; the worker checks each platform's current rules in
  the PR and writes them down.

  | Platform | Stored | URL the app builds | Format to check |
  |---|---|---|---|
  | Instagram | handle | `https://www.instagram.com/<handle>/` | `[A-Za-z0-9._]{1,30}`, no leading, trailing or double dot |
  | TikTok | handle | `https://www.tiktok.com/@<handle>` | `[A-Za-z0-9._]{2,24}`, no trailing dot |
  | YouTube | handle, or channel id | `https://www.youtube.com/@<handle>` / `…/channel/<id>` | handle `[A-Za-z0-9._-]{3,30}`; id `UC[A-Za-z0-9_-]{22}` |
  | Goodreads | numeric user id | `https://www.goodreads.com/user/show/<id>` | `[0-9]{1,12}` |
  | StoryGraph | username | `https://app.thestorygraph.com/profile/<username>` | to verify |
  | Hardcover | username | `https://hardcover.app/@<username>` | to verify |
  | Fable | username | the profile URL Fable uses | to verify |

  Letterboxd is films, so it does not fit a books app. Bluesky or Threads are possible additions (owner question).
  A pasted profile URL is parsed **on the device**, only for that platform's own hosts, into the handle. The server
  never accepts a URL.
- **Database (one migration):**
  - **Table** `public.member_links (member_id → accounts on delete cascade, platform text check in (…), handle
    text, position smallint, updated_at)`, primary key `(member_id, platform)`: one per platform, at most seven.
    RLS: select own only.
  - **Visibility** lives in `public.member_link_settings (member_id pk, visibility text check in
    ('everyone','followers','me') default 'followers')`. It is its own table on purpose: it touches neither
    `social_settings` nor `private.my_social_json`, and so stays out of the SQL chain.
  - **Write** `set_member_links(p_links jsonb, p_visibility text)`:
    - per-platform regex and length checks, with WP-26's `private.public_text_ok` as the base;
    - online only, like every social write;
    - **10 calls an hour** (a calls table, the follow pattern);
    - errors `link_invalid:<platform>`, `rate_limited`.
  - **Read** `member_links(p_member)`, security definer:
    - `me`: only herself;
    - `followers`: herself and accepted followers;
    - `everyone`: whoever may see her profile (`private.visible`);
    - never across a block.
  - **Owner action** `owner_clear_member_links(member)` for WP-25.
- **Recommended default visibility: followers only.**
  - On a private account that is the people she accepted.
  - On a public account it keeps links from strangers who only opened her link and did not follow.
  - "Everyone" is her explicit choice.
  - Not on the public reading page (`/r/<token>`) for now.
- **App:**
  - An Account row "Links" opens a sheet: one field per platform with the fixed prefix shown ("instagram.com/"),
    paste-a-URL extraction, and the visibility as a segmented control.
  - A row of platform marks under the name in `components/profile/Hero.vue` and `components/friends/MemberHero.vue`.
    The marks are the app's own monochrome glyphs or text chips, no third-party icon kit.
  - Each mark is a link: `target="_blank" rel="noopener noreferrer nofollow ugc"`, an external-link indicator, and the
    accessible name "{platform}: {handle}, opens {platform}".
  - Data layer in `data/social.ts` (or a new `data/memberLinks.ts`).
- **Report path:** WP-25 gets the reason "links" and the owner action above.
- **Privacy notice (EN and DE):** a new optional category, "links to your profiles on other platforms": the handles
  she enters, who sees them (her setting), deletable at any time, deleted with the account. Opening one takes the
  viewer to a third party with its own privacy policy, with no referrer sent.
- **Account deletion and export:**
  - Deletion: the cascade from `accounts`/`auth.users` covers it (pgTAP).
  - Export: there is no member-facing data export today; `data/export/memberLibrary.ts` is the Library export for
    Regal. Add the links to any future GDPR export.
- **German:** `account.links` ("Links"), `links.title` ("Your profiles elsewhere" / "Deine Profile anderswo"),
  `links.placeholder`, `links.pasteHint`, `links.invalid.<platform>`,
  `links.visibility.everyone|followers|me` ("Everyone who can see your profile" / "Alle, die dein Profil sehen";
  "Followers only" / "Nur Follower"; "Only me" / "Nur ich"), `links.opens` ("Opens {platform}" / "Öffnet
  {platform}"). Platform names stay brand names.
- **Shared profile-edit UI with WP-16?** No. Bio and links each get their own sheet and Account row, and links use
  their own table and RPC, so **WP-22 and WP-16 can run in parallel**. They only meet in disjoint hunks of the two
  heroes and `Account.vue` (≈). A single "Edit profile" sheet can merge them later. WP-22 is wave 3 and WP-16 is
  wave 4, because WP-16 also waits for WP-12.
- **Tests:**
  - pgTAP: accept and reject lists per platform; a URL is refused; seven-link cap; rate limit; each visibility case
    (me, followers, everyone, requester, stranger, blocked both ways); the deletion cascade; the owner action refuses
    non-owners.
  - Vitest: the paste parser and URL builder per platform, including other hosts and `javascript:` refused.
  - Playwright locally only.
- **Acceptance:**
  - She adds an Instagram handle and a Goodreads id, picks a visibility, and the right people (and only they) see two
    marks under her name that open the canonical profile URLs in a new tab.
  - A pasted `https://www.instagram.com/name/?igsh=…` is stored as `name`.
  - Any non-allow-listed host or free URL is refused, client and server.
  - Report → "links" reaches the owner, who can clear them.
  - The privacy notice names the category in EN and DE.
- **Size and model:** M; Sonnet.
- **Open questions:** Add Bluesky or Threads? Default visibility (recommended: followers only)? Show on the
  reading page later?

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

### WP-26 Name rules and a shared text rule. P3 · M · Sonnet (Opus review) · wave 2 (after the sign-in worker's `auth.ts` work merges) · also in #331
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

## 8. Waves, hotspots and the critical path

**Waves** (packages in one wave touch disjoint files, or the same file in disjoint hunks, marked ≈):

Revision 3: waves count from now (`origin/main` `1127a7df`). Shipped packages are gone from the table, and the open
sign-up packages wait in #331.

| Wave | HIGH (priority:high) | LOW (fills spare capacity) |
|---|---|---|
| 1 | WP-02 follow-up (an iOS device check, then the Stack in Regal only if needed), WP-06, WP-22 (≈ `web/i18n/locales/*` with WP-06) | WP-15, WP-13 |
| 2 | WP-07 (← WP-06), WP-08 (← WP-06; ≈ `pages/profile/index.vue` with WP-07) | WP-14 (← WP-13), WP-26 (← the sign-in worker's `auth.ts` work merged) |
| 3 | none | WP-17 (← WP-14; `import_books` after the import work settles), WP-20 (← WP-08), WP-11 (filler, any wave) |
| 4 | none | WP-18 (← WP-17, WP-15), WP-16 (← WP-26; after WP-17 in the `member_profile` chain), WP-12 (← WP-11, WP-14, WP-26) |
| 5 | none | WP-19 (← WP-18; after the import worker's PRs #327, #328, #329) |
| parked | none | WP-21, WP-23 |
| postponed (#331) | none | WP-24, WP-25, WP-27 (and WP-26 if it has not landed by then) |

**Collisions with the running workers:**
- The **cover and import worker** owns `web/app/data/import*`, `data/covers.ts`, `data/coverFill.ts` and
  `data/bookImport.ts`. Nothing in waves 1–2 touches them. WP-17 (`import_books`) and WP-19 (the importers) wait.
- The **sign-in and shelf-retry worker** owns `web/app/data/auth.ts`, the sign-in screens and `stores/shelf.ts`.
  - WP-26 (`cleanName` in `auth.ts`) waits for it.
  - WP-02's follow-up works in Regal and does not touch `stores/shelf.ts`.
  - WP-18 touches `data/memberShelf.ts`, not `stores/shelf.ts`.

**Critical paths:**
- **HIGH:** WP-06 → WP-07 ∥ WP-08. Two waves; all of priority:high is done after wave 2.
- **Overall:** WP-13 → WP-14 → WP-17 → WP-18 → WP-19, five waves. The chain is set by the SQL functions redefined in
  full (`sync_write` for WP-14 → WP-17, `member_profile` for WP-17 → WP-16) and by the import worker's files.
- **Open sign-up (whenever the owner opens #331):** WP-24 ∥ WP-25 ∥ WP-27, then a check of WP-12, WP-16, WP-21 and
  WP-22 against the report reasons and WP-26's text rule.

**Shared-file hotspots** (who touches what):

| File | Packages |
|---|---|
| `web/app/pages/profile/index.vue` | WP-01, WP-03, WP-05, WP-06, WP-08, WP-18 (Library line), WP-20 |
| `pages/profile/[year].vue`, `pages/friends/[member]/[year].vue` | WP-01, WP-05, WP-06, WP-09 |
| `pages/friends/[member]/index.vue` | WP-01, WP-05, WP-06, WP-08 (if on member pages), WP-12 |
| `stores/stats.ts` | WP-05, WP-06, WP-08, WP-20 |
| `data/stats.ts` | WP-06, WP-08, WP-09, WP-18, WP-20 |
| `components/profile/ReadsSheet.vue`, `ReadRow.vue` | WP-05, WP-07 |
| `stores/collections.ts`, `data/collections.ts` | WP-10, WP-12, WP-14, WP-21 |
| `pages/collections/[id].vue` | WP-10, WP-12, WP-21 |
| `components/collections/EntryList.vue` | WP-10, WP-13, WP-18 |
| `pages/library.vue`, `ViewBar.vue`, `EntryRow.vue`, `data/libraryView.ts` | WP-10 (`SortSheet`), WP-15, WP-18 |
| `components/profile/Hero.vue`, `components/friends/MemberHero.vue`, `Account.vue` | WP-03, WP-16, WP-22 (≈ WP-16 and WP-22: disjoint hunks, a line each in the heroes, a row each in Account) |
| `web/app/legal/privacy.ts` | WP-22 (its own line), WP-27 (postponed, #331), then WP-12, WP-22 (≈, different bullets), WP-16, (WP-21) |
| `web/app/pages/sign-up.vue`, `data/auth.ts` (sign-in and sign-up), `supabase/config.toml` | WP-24 |
| `data/auth.ts` (`cleanName`), `components/shell/NameSheet.vue` | WP-26 (WP-03 only opens the sheet) |
| `components/friends/MemberSheet.vue`, `pages/profile/feedback.vue`, `public.feedback` | WP-25 |
| `SPEC.md`, `docs/OPERATIONS.md`, `docs/legal-checklist.md` | WP-24 (SETUP and OPERATIONS steps), WP-27 |
| SQL `signup_invite` and the `auth.users` triggers, the avatars policies | WP-24; WP-26 adds an `auth.users` update trigger (serialize the two migrations) |
| SQL `private.member_name` | WP-26 |
| SQL `sync_write` | WP-14, WP-17 |
| SQL `member_profile`, `private.my_social_json` | WP-11 (only with a section switch), WP-16, WP-17 |
| SQL `public_reading_page`, `feed`, `circle_reading`, `book_readers` | WP-17 |
| SQL `delete_my_account` | WP-21 |
| `web/i18n/locales/{en,de}.json`, `docs/parity.md` | all (add keys in each feature's own block; rebase) |

---

## 9. Open questions for the owner (by package)

- **WP-01:** a named ("Authors {name} returns to") or neutral ("Most-read authors") label? Remove the pill on member
  profiles too?
- **WP-02:** iOS version; Safari or the home-screen app; which screens; did it ever work; pin the Regal commit?
- **WP-03:** a pencil beside the name?
- **WP-04:** variant A or B; keep the heart and Want to read on each row?
- **WP-05:** page size; a button or auto-load?
- **WP-06:** an author row → sheet or → author page; keep "Show in Library"?
- **WP-07:** stars inline or a small sheet; rating only?
- **WP-08:** the range of weeks; on member profiles; remember the mode?
- **WP-09:** 5.00 only or ≥ 4.75; row or grid; title?
- **WP-10:** remember the sort; which "date added"?
- **WP-11:** private by default; a Privacy section switch too; on the public reading page ever?
- **WP-12:** a page or a sheet for her Collection; where on her profile?
- **WP-14:** the mode per device or per account; a new Collection on top or at the end?
- **WP-15:** per status or global; the Collection page too; a date or a duration?
- **WP-16:** length; line breaks; who sees it; the German label?
- **WP-17/18:** progress resumes; followers see paused under Currently reading; no feed event; add straight as On
  hold; a section or a segment; counted in the Library line; on the shelf?
- **WP-19:** which shelf names?
- **WP-20:** its place on the Profile; the custom range's maximum?
- **WP-21:** do it at all?
- **WP-22:** the platform list (add Bluesky or Threads?); the default visibility (recommended: followers only); show
  links on the public reading page (recommended: not now)?
- **WP-23:** build the self-only counts now? Keep public counts parked?
- **WP-24 (#331, postponed):** Turnstile account and keys; the project email limit (30 an hour today); keep invite
  codes as a perk? The waitlist's fate?
  Turnstile? The email budget (the Resend plan, Supabase's email rate limit)?
- **WP-25:** is the owner the only moderator? Tell members why content was removed? Is "under 16" a reason?
- **WP-26:** the reserved-name list; unique names (recommended: no)?
- **WP-27 (#331, postponed):** a postal address before opening; how long reports are kept; community rules wording
  (owner's voice)?

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
