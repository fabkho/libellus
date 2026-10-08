# Social, version 1: the scope

The owner's answers to [social.md](social.md) §10 (8 October 2026), turned into what version 1 ships.
`social.md` stays the research behind it: the data designs, the RLS reasoning, the ideas. Where
the two differ, this file wins.

Mocks of every version 1 screen, in both themes: [`social/mock.html`](social/mock.html) (open it in
a browser; *Switch room* flips light and dark) and its screenshots, screens 1–16 (each caption names the
features it shows, by the letters and numbers of the list below):

| | Light | Dark |
|---|---|---|
| The feed (1–4) | ![](social/v1-feed-light.png) | ![](social/v1-feed-dark.png) |
| Profiles (5–8) | ![](social/v1-profiles-light.png) | ![](social/v1-profiles-dark.png) |
| People (9–12) | ![](social/v1-people-light.png) | ![](social/v1-people-dark.png) |
| Her side (13–16) | ![](social/v1-settings-light.png) | ![](social/v1-settings-dark.png) |

## Decisions

| # | Question | Answer |
|---|---|---|
| 1 | Consent model | **Like Instagram: a private account by default.** A private account approves each follower (a request she accepts or declines). A **public** account can be followed by any member who reaches her profile, without asking. |
| 2 | Finding each other | **The follow link only**, for now. Other ways (the reading page, an address, suggestions) maybe later. |
| 3 | What followers see by default | **Everything on**, reviews and Did not finish included. Each stays a switch she can turn off. |
| 4 | Manual books and own editions | **Shown to followers like any Book**, unless she hides one (below for the reasons against and the copy that changes). |
| 5 | Where the feed lives | **On Home**: a few entries and **Show more**, which opens the whole feed on its own page. No new tab. |
| 6 | Followers see her photo | **Yes.** |

Kept from the proposal without a question: the 10-minute settle window, imports and old reads
never make an entry, no counts or likes, no notifications, the outbox never queues a follow-related
write, nothing visible to anyone until she lets a follower in (or makes her account public).

### Question 4: what speaks against showing Manual books

Three things, none of them a reason to hide them by default:

- **The app promises the opposite today.** `manual.private` says "Only you can see this book. It
  stays out of the shared catalogue." and `ownEdition.private` "Only you can see your edition. …"
  (`web/i18n/locales/en.json`, under the Manual book and My edition isn't listed sheets). Both become
  untrue the day a follower sees her reads. They change to: "It stays out of the shared catalogue.
  Your followers see it with your reads; hide it from them in its ⋯ menu." CONTEXT.md's "Manual book
  — … Private to that Member" changes the same way: private to her *Library*, not secret from her
  followers.
- **A follower cannot open it.** `books_readable` lets only the owner read a Manual book's row, so
  its cover in the feed or on her profile opens nothing (the row is still shown, with its title,
  authors and her stars).
- **Typed-in books can be personal** (a draft, a work file, a diary kept as a "book"). Rare, and that
  is what *Hide from followers* is for.

Against hiding them: her own edition is a Manual book (SPEC.md, Decisions), used for ordinary
paperbacks no source knows. Hiding all Manual books would make normal reads vanish from her feed and
make the figures her followers see disagree with the covers they see. The public reading page
already shows them (`private.reading_page_reads` joins `books` without an owner filter).

## Version 1: what is included

### A. Her privacy

1. **Private account**, on by default for every member, existing ones included. While it is on,
   nobody sees anything of hers until she accepts their request.
2. **Public account**: switching *Private account* off lets any member who reaches her profile
   follow at once and see it without following. Requests still waiting are accepted when she goes
   public (as Instagram does), after a Confirm that says so. Going private again keeps the
   followers she has.
3. **What followers see**: seven switches, all on by default: Currently reading, Want to read,
   Finished, Ratings, Reviews, Did not finish, Year in review and figures. A switch applies to the
   feed, her profile and her figures at once, including what happened before it was turned off. The
   reason she gave for not finishing never leaves her Library; the switch shows only that she put the
   Book down.
4. **Hide from followers**, per Book, in the Book's ⋯ sheet. A hidden Book is gone for everyone else
   from the feed, her profile, her counts and her figures. It waits in the outbox offline like the
   other changes to her own Books.
5. **Your follow link** (`/f/<token>`, 128 random bits): **Share** (the share sheet), **Copy**, **New
   link** (the old one stops working, behind a Confirm). It exists from the first time she opens
   Friends; it does not depend on the account being private or public.
6. **Blocked**: the members she blocked, each with **Unblock**, at the end of the settings sheet.

### B. Following

7. **Opening someone's follow link** (signed in) opens her profile. Signed out, Sign in comes first
   and then the profile.
   - Public account: the full profile and **Follow**.
   - Private account: her photo, name and "Private account. Ask to follow to see her reading.",
     **Ask to follow**; once asked, **Requested** (tap to withdraw).
   - Already following: the full profile.
   - Her own link: her own Profile.
   - A dead link, or someone who blocked you: "This link isn't here any more." Nothing says why.
8. **Follow requests**: a quiet row at the top of Home's *Your circle* ("Ida asked to follow you"),
   the Requests segment of *People*, and the value of the Profile's *People* row ("1 request"). A
   lamp dot on the header's avatar while one waits, no number. **Accept** or **Decline**; declining
   tells nobody, and to the asker it stays "Requested".
9. **Follow back**: after accepting, the row offers **Follow back** (a request or an instant follow,
   by the other's privacy). The same button sits next to any follower she does not follow yet.
10. **People** (`/friends/people`): **Following**, **Followers**, **Requests** (when there are any).
    Rows: photo, name, a chevron to the profile. No counts anywhere.
11. **Unfollow**, **Remove follower**, **Block**: from a member's ⋯ (on her profile) and a row's ⋯ in
    People. All silent. Block removes both directions, refuses her requests and link visits and
    hides each from the other everywhere.
12. **Limits**: 150 follows, 20 open requests, 30 follow calls an hour (`follow_limit`,
    `rate_limited`).

### C. The feed

13. **Your circle on Home**, last, after *Next in your series*. The newest **3** entries and **Show
    more** to the feed page. A pending request comes first as its own row. Hidden altogether for a
    member who follows nobody and has no request: Home does not nudge anyone to be social.
14. **The feed page** (`/friends`, pushed). Newest first, grouped under day eyebrows (Today,
    Yesterday, Monday, 3 Oct), 30 at a time, more as she scrolls. Pull to refresh. The ⚇ button at
    the top right opens People.
15. **Entries**: started (and "started again" for a re-read), finished (with her stars and her
    review, the first four lines with **More**), did not finish, added to Want to read, reviewed (a
    review written after the finish). A rating changed later shows as the current stars, never as an
    entry of its own.
16. **Batches**: three or more of the same kind by the same member on the same day fold into one row
    with a fan of covers ("Clara finished 3 books"), which opens a sheet with the Books.
17. **Never an entry**: imports (Goodreads, Hardcover, the owner's Fable import), a finish or DNF
    logged with an end more than 14 days back, anything in its first 10 minutes (a correction inside
    them replaces it), a hidden Book, a switched-off section.
18. **Tapping**: a cover or title opens the Book page (the cover flies as everywhere else; a Manual
    book opens nothing); the name or photo opens her profile; a batch opens its sheet.
19. **Offline**: the last page the device saw, with "Offline · as of 14:02". A copy older than 7
    days is not shown. Signing out deletes it.
20. **Empty states**: following nobody: "Reading is better with a friend or two." with **Share your
    follow link**; following people, nothing yet: "Quiet for now. When the people you follow start
    or finish a book, it shows here."

### D. A member's profile and year in review

21. **Her profile** (`/friends/<member>`), lit by her favourite cover like the Profile: photo or
    initials, name, "Reading here since …", the Library line (read · reading · want). Then, by her
    switches: Currently reading (covers, "since 3 Oct", no progress), Want to read (the newest 12,
    then **See all**), the year pills with the four figures, By year / By month, Ratings, Records,
    Authors you return to, Recently finished (stars, the day, the review folded at four lines), Years
    in review. Her ⋯: Unfollow · Remove as follower · Block.
22. **Her year in review** (`/friends/<member>/<year>`): the months as rows of covers, the favourite,
    ratings, records, authors and the years either side, as on your own. Never her reading days or
    progress.
23. **Not on her profile in version 1**: her Collections, her reading days, her highlights, "you
    both read" (version 2).

### E. Her own Profile

24. A **Friends** section before *Share*: **People** (value: "1 request" when one waits), **Your
    follow link**, **Privacy** (opens the *Friends and sharing* sheet: Private account, What
    followers see, Blocked). The *Reading page* row stays where it is, under *Share*.

### F. Under the hood

- **Database** (one migration, pgTAP): `social_settings` (`private` default true, the seven
  switches, `follow_token`), `follows` (`accepted_at` null = a request), `blocks`,
  `library_entries.hidden`, `activity` with its triggers (deferred on entry insert), the quiet flag
  in `import_books` / `import_book_for`, `feed()`, `member_profile()`, `member_reading_record()`
  (rows in `SESSION_COLUMNS`' shape, so `data/stats.ts` computes her figures unchanged),
  `follow_target(token)`, `follow()`, `answer_request()`, `unfollow()`, `remove_follower()`,
  `block()`, `unblock()`, `set_private()`, `set_social_sections()`, `renew_follow_link()`,
  `set_entry_hidden()` (also in `sync_write`), the avatars select policy for followers (and for any
  member while the account is public), `purge_activity()` on pg_cron. `delete_my_account()` needs no
  change: everything cascades.
- **Web**: `data/social.ts`, `data/feed.ts` (batching, framework-free), `stores/social.ts`,
  `stores/feed.ts`, `stores/memberStats.ts`; pages `friends/index.vue`, `friends/people.vue`,
  `friends/[member]/index.vue`, `friends/[member]/[year].vue`, `f/[token].vue`; Home's
  `components/home/Circle.vue`; `components/friends/*` (Row, Batch, BatchSheet, Hero, RequestRow,
  MemberSheet); the `Hero` and the Profile blocks taking a member; the error log reporting
  `/friends/[member]`, never the id.
- **Offline**: every follow-related write and every switch is online-only and says "Offline";
  only *Hide from followers* waits in the outbox.
- **Copy and docs**: `photo.private`, `manual.private`, `ownEdition.private`,
  `profile.deleteAccount.text`, `sharing.about`; SPEC.md (non-goals, decisions, data model, screens,
  privacy), CONTEXT.md (Follower, Follow request, Private account, Public account, Follow link,
  Circle, Hidden from followers; Manual book), README's intro and *What it does* (its Privacy section
  is #212's), parity.md entries for every screen above.
- **Tests**: pgTAP as four real members (private, public, follower, stranger), Vitest for the
  repositories and batching, Playwright for the link → request → accept → feed → profile flow, the
  public follow, block, hide, offline labels, and the a11y scans of every new screen and sheet in
  both themes.

### Build order

| Slice | What | Model tier |
|---|---|---|
| 1 | The database: everything in F's first bullet, with pgTAP | heavy (Opus 5.5) |
| 2 | Privacy and following: E, A, B (settings sheet, follow link page, People, requests, ⋯, block) | advanced (Sonnet 5.5) |
| 3 | The feed: C (Home's *Your circle*, the feed page, batches, offline) | heavy (Opus 5.5): the design-heavy part |
| 4 | Profiles: D (her profile and year in review on the Profile's blocks) | advanced (Sonnet 5.5) |

## Version 2: proposed

In the order I would build them. Nothing here is decided.

| # | Feature | Why now | Effort |
|---|---|---|---|
| 1 | **Spoiler-safe reviews.** "Contains spoilers" on the Finish and Edit read sheets; followers who have not finished the Book see it folded behind *Show anyway*. | Reviews are on by default in version 1, so the next friend to read the Book meets them. Small enough to pull into version 1 if that worries you. | S |
| 2 | **Want to read too.** One quiet button on a feed entry and a profile's Books: puts the Book on your Want to read and tells her once, in her *Your circle* ("Ida wants to read this too"). | The reaction a reading app needs instead of likes: it ends in a Book on a shelf. | S |
| 3 | **Your circle on a Book's page.** "Anna ★4.5 · Ben is reading it", under the Goodreads line, matched by work so other editions count. | The Book page is where she decides; a friend's stars beat a stranger's average. | S–M |
| 4 | **You both read.** On a profile and her year in review: the Books you both finished, both your stars side by side. No totals. | Uses the same work matching as #3. | S |
| 5 | **Send a book.** Book ⋯ → *Send to…* a follower, with a note. It lands in a *For you* row on Home, not in the feed; one tap puts it on Want to read. | Recommendations between two people, the way it happens anyway, only kept. | M |
| 6 | **More ways to find people.** *Ask to follow* in the footer of a reading page for signed-in visitors; *Ask by email* (the same answer whether or not the address is a member); the owner's waitlist invite carrying the follow request of the member whose page it came from. | Decision 2 said "later". | M |
| 7 | **Reading the same book now.** The small photos of followed members who have the same work open, on your Home card. | A free by-product of #3. | S |
| 8 | **Friends' Want to read on yours.** A tiny photo on Books a followed member also wants to read. | Prepares buddy reads. | S |

After version 2: reading together (buddy reads with progress and page-pinned notes), *Our year*
for the circle in December, shared Collections, a weekly letter by email, *Ask my circle*, and the
small games (social.md §8). Notifications only for things addressed to you, and only once the app
is a home-screen or Play app (#102).
