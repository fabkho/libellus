# Social version 2a: the contract

What version 2a builds, fixed before the tasks start. Scope and the owner's decisions:
`docs/proposals/social-v1.md`, *Version 2* (items 1, 2, 4, 7, 8 and *A checked Catalogue*). Version 1's
contract (`social-v1-contract.md`) still holds: who may see what (`private.visible`, `private.reachable`,
the seven switches, hidden Books, blocks both ways) is reused, never re-implemented.

Two pull requests: **A** (§1–§4, migration `20261021010000_social_v2a.sql`) and **B** (§5, migration
`20261021020000_catalogue_check.sql` and an edge function). Main's perf work takes `20261020*`.

## 1. Database (PR A)

Every new function: `security definer`, `set search_path = ''`, revoked from `public` and `anon`, granted to
`authenticated`; refusals as named messages with `PT404` / `PT429` (as v1.1). "Same book" means the same
`books.id`, or the same non-null `books.openlibrary_work_key`.

### 1.1 Spoiler-safe reviews

- `reading_sessions.review_spoilers boolean not null default false`. Written wherever `review` is written
  (the finish and edit-read paths, `sync_write`'s actions that carry a review): find each, add the argument
  (default false), keep old calls working.
- Every answer that hands another member's review out (feed entries, `member_profile` finished rows,
  `public_reading_page` / `public_book_card`) adds `"spoilers": true|false` and, when true and **the caller
  has no finished read of the same book**, `"review"` is still sent but `"folded": true` (the client hides it
  behind *Show anyway*). Anonymous callers (reading page) are always folded. Her own answers: never folded.

### 1.2 Likes

- Table `public.likes (member_id uuid references accounts on delete cascade, session_id uuid references
  reading_sessions on delete cascade, created_at timestamptz default now(), primary key (member_id,
  session_id))`, RLS on, no grants. A like is on **a finished read** (its finish and its review are one thing
  to like).
- `like(p_session uuid)`, `unlike(p_session uuid)`: the caller must be able to see that finished read
  (accepted follower or public account, `show_finished` on, the Book not hidden, no block); not her own;
  `not_found` otherwise (same answer for "does not exist"). Idempotent. Rate limit: 300 likes an hour per
  member (`rate_limited`).
- Answers that carry a finished read (feed `finished` / `reviewed` entries, `member_profile.finished`, her
  own finished reads where they show with likes) add `"likes": <count>` and `"liked": true|false` (the caller).
  The count counts only likes the database still allows (see clean-up).
- `session_likers(p_session uuid)`: **only the read's owner**; `[MemberCard]` newest first (names and
  photos by the v1 card rules). Anyone else: `not_found`.
- `my_recent_likes()`: for Home's *Your circle*: the newest likes on her reads of the last 7 days, grouped
  per read: `[{ session, book (social json), likers: [MemberCard] (max 3), count, at }]`, at most 5 reads.
- Clean-up: when a follow ends (unfollow, remove follower, block) the likes the former follower gave on the
  other member's reads are deleted (a public account keeps strangers' likes until a block). A hidden Book's
  likes stay but are not counted or listed while it is hidden.

### 1.3 You both read

`both_read(p_member uuid, p_year int default null)`: the books the caller and the member both finished
(same book), only where the member's finished reads are visible to the caller (as `member_reading_record`);
`[{ book (social json, the member's edition), mine: { rating, endedOn }, hers: { rating (null without
show_ratings), endedOn } }]`, newest of hers first; `p_year` limits to her reads ended that year. No totals.

### 1.4 Reading the same book now, and friends' Want to read on hers

- `circle_reading(p_books uuid[])`: for each of the caller's Books given (her open reads), the followed
  members (accepted, `show_reading`, not hidden, no block) with an open read of the same book:
  `[{ book: uuid (hers), members: [MemberCard] (max 3), more: int }]`; Books with nobody are left out.
  At most 50 ids.
- `circle_want(p_books uuid[])`: the same for her Want to read Books and members' Want to read
  (`show_want`).

## 2. Data layer (PR A)

`web/app/data/social.ts` (and `socialShapes.ts`): `like`, `unlike`, `sessionLikers`, `myRecentLikes`,
`bothRead`, `circleReading`, `circleWant`, and the new fields on feed entries and member finished rows
(`spoilers`, `folded`, `likes`, `liked`, `sessionId`). Likes and spoiler flags are **online only** (say
"Offline"); writing `review_spoilers` with a review goes the review's way (queued with it offline).

## 3. Screens (PR A)

- **Spoilers**: "Contains spoilers" (a switch) under the review field in the finish and edit-read sheets; a
  folded review shows "Contains spoilers · Show anyway" in its place (feed, Home's card, a member's
  finished rows, the reading page), the stars and the rest unchanged.
- **Likes**: a heart with its count (count hidden at 0) on finished/reviewed entries in the feed, Home's
  card and a member's Recently finished rows; tap toggles; the author's own entries show the count and
  open `session_likers` in a sheet. Home's *Your circle* gets one quiet row per liked read from
  `my_recent_likes` ("Anna and Ben liked your review of *Piranesi*", "Anna and 4 others …").
- **Want to read** button beside the heart (owner's decision): adds the Book to her Library as Want to
  read through the existing add (offline too, the outbox). Only there to add (owner's decision): a Book already in
  her Library, in any list, shows no button and no state, and the feed says nothing of where it is; after an add
  it says *Added* for a moment. Not on Manual books. The friend is not told.
- **You both read**: a section on a member's profile and her year page (with `p_year`), covers with both
  stars, hidden when empty.
- **Reading now** on Home's reading cards and **Want too** on her Want to read covers (Home's Up next, the
  Library's Want to read): up to three small avatars on the cover's edge, "+N", a tap opens a small sheet
  with the names.

## 4. Test ids, strings, flow (PR A)

Test ids per element as v1 (`feed.like`, `feed.likes`, `feed.wantToRead`, `member.bothRead`,
`home.readingWith`, `likers` sheet, `review.spoilers`, `review.showAnyway`, …: the tasks list theirs here).
Strings under `social.*` / `review.*`, plain as v1's. **E2e**: the friends flow (`e2e/friends.spec.ts`) gains
the like (Anna likes Ida's finish, Ida sees the count and Anna's name) and a spoiler fold; no new flow.

### Screens built without the database (task V2A-B1)

Props-only components and strings, wired by a later task. Test ids: `<row>WantToRead` (`friends.entryWantToRead`
on a feed row, `home.circleFeature.wantToRead`, `member.finishedWantToRead`; `.error` under each),
`finish.spoilers` and `editSession.spoilers` (the switch in the footer of the review box in the two sheets, shown once there is a review, off by default, written nowhere
yet; `v-model:spoilers` on each sheet), `feed.like` (`LikeButton`, `.count` inside), `likers` (`LikersSheet`,
`likers.row`, `likers.member`, `likers.empty`, `likers.error`, `likers.offline`). Keys in `en.json`:
`social.wantToRead.{add,label,added,error}`,
`social.like.{like,unlike,label,unlabel,count,ownLabel,error}`, `social.likers.{title,empty,loadError,offline}`,
`review.{spoilers,folded,showAnyway}`.

## 5. A checked Catalogue (PR B)

- `books.checked_at timestamptz` (null = not checked) and `books.check_failed boolean default false`.
  Rows a client creates through `catalogue_book_for` start unchecked; existing rows are unchecked too, so
  the check works through them over time. Manual books (`owner_id` set) are never checked.
- A server check, modelled on the enrichment queue (`20261011012000_enrichment_queue.sql`, the `enrich`
  edge function, `pg_net`, `pg_cron`): every minute, up to N unchecked Books are sent to an edge function
  `catalogue-check`, which looks each up at its source (Apple: the iTunes lookup by `apple_id`; Open Library:
  the edition or work key, or the ISBN) and writes **title, authors, description, cover url** from the
  source (cover through the existing cover rules), sets `checked_at`; a Book its source does not know gets
  `check_failed = true`, `checked_at` set, and keeps its data. Rate-limit friendly (N small, backoff).
- Until checked, social answers and the public reading page hand out an unchecked Book's **title and
  author** but not its **description**, and its cover only by the S1 allowlist (as now). The window is
  minutes; the member's own Library shows her row as she added it.
- Security: the edge function runs with the service role, takes no input from members (it reads the queue),
  fetches only the fixed source hosts, and validates the answers (types, lengths, https cover).
