# Social version 1: the contract

The fixed interface every task of [social-v1-plan.md](social-v1-plan.md) builds against. What the
database answers, what the repositories return, the routes, test ids and strings. A task implements
its part exactly as written; a change to this file is the orchestrator's, before the task, never
inside it. Behaviour and reasons: [social-v1.md](social-v1.md).

Words: **the caller** is the signed-in member (`auth.uid()`); **the owner** is the member whose
settings, reading or follows are asked about or acted on (for D1's setters, the caller herself).
"Visible" always means: computed in a definer function at read time from the current follows, blocks,
the owner's switches and her hidden Books. A member without a `social_settings` row counts as private
with every section on, everywhere (`private.social_of`).

---

## 1. Database

Four migrations, one per task, in this order (timestamps after `20261014020000`):

| Task | File |
|---|---|
| D1 | `supabase/migrations/20261017010000_social_settings.sql` |
| D2 | `supabase/migrations/20261017020000_social_follows.sql` |
| D3 | `supabase/migrations/20261017030000_social_activity.sql` |
| D4 | `supabase/migrations/20261017040000_social_readers.sql` |

Conventions, as in the existing migrations: a header comment saying what and why; `security
definer` functions with `set search_path` pinned; `revoke all … from public, anon` then `grant execute
… to authenticated` on every public function; helpers in `private` (revoked from every API role);
refusals as `raise exception '<code>' using errcode = '<sqlstate>'`; triggers' functions revoked
(`20261003144600_revoke_trigger_function_execute.sql`). Supabase grants every new `public` table to the
API roles by default: every new table gets an explicit `revoke all on … from anon, authenticated` (as
`reading_pages` does) before its one grant, if it has one.

**Every function returns `jsonb`** (or `void`/`boolean` where the tables say so); a list is `[]`, never
null; every key in the shapes below is always present, with `null` where it has no value (never
`jsonb_strip_nulls`).

### 1.1 Refusals

| Code | SQLSTATE | When |
|---|---|---|
| `not_signed_in` | `42501` | no `auth.uid()` |
| `not_found` | `P0002` | a member, link or request that is unknown, blocked either way, or not reachable: always the same answer, never "forbidden" |
| `entry_not_found` | `P0002` | an entry that is not hers |
| `follow_self` | `22023` | following or blocking herself (checked before anything else) |
| `follow_limit` | `54000` | the caller has 150 rows in `follows` already (accepted, asked or declined), or 20 that are not accepted (asked or declined) |
| `rate_limited` | `54000` | 30 or more `follow` calls logged for the caller in the last hour (a refused call rolls back with its own log row) |
| `social_sections_invalid` | `22023` | `set_social_sections` with an unknown key or a non-boolean |

### 1.2 Tables (D1, D3)

```sql
-- D1
create table public.social_settings (
  member_id      uuid primary key references auth.users on delete cascade,
  private        boolean not null default true,
  show_reading   boolean not null default true,
  show_want      boolean not null default true,
  show_finished  boolean not null default true,
  show_ratings   boolean not null default true,
  show_reviews   boolean not null default true,
  show_abandoned boolean not null default true,
  show_year      boolean not null default true,
  follow_token   text not null unique check (follow_token ~ '^[A-Za-z0-9_-]{22}$'),  -- private.reading_page_token(): 16 random bytes, base64url, padding stripped
  updated_at     timestamptz not null default now()
);
-- A member without a row has the defaults above (private, everything on) and no link yet;
-- private.social_of(member) answers that. The row is made by my_social() or any setter.

create table public.follows (
  follower_id  uuid not null references auth.users on delete cascade,
  followee_id  uuid not null references auth.users on delete cascade,
  requested_at timestamptz not null default now(),
  accepted_at  timestamptz,          -- null: a request
  declined_at  timestamptz,          -- set: declined; the asker still sees "requested"
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id),
  check (accepted_at is null or declined_at is null)
);
create index follows_followee on public.follows (followee_id);

create table public.blocks (
  blocker_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- Who opened whose follow link (follow_target writes it): what lets a private account's
-- card, photo and "Ask to follow" reach a member at all.
create table public.follow_link_views (
  visitor_id uuid not null references auth.users on delete cascade,
  member_id  uuid not null references auth.users on delete cascade,
  viewed_at  timestamptz not null default now(),
  primary key (visitor_id, member_id)
);

alter table public.library_entries add column hidden boolean not null default false;

-- One row: settings of the social machinery itself (tests shorten the window).
create table private.social_config (
  id            boolean primary key default true check (id),
  settle_window interval not null default interval '10 minutes'
);
insert into private.social_config default values;

-- Calls of follow(), for the hourly limit; rows older than a day are deleted by follow() itself.
create table private.follow_calls (member_id uuid not null references auth.users on delete cascade,
                                   at timestamptz not null default now());
create index follow_calls_member_at on private.follow_calls (member_id, at);
```

RLS on every new `public` table, **no grants to `anon` or `authenticated`** except:
`social_settings` select own (`member_id = (select auth.uid())`). `follows`, `blocks`,
`follow_link_views` and `activity` are read only through the functions below (the asker must never
see `declined_at`).

```sql
-- D3
create table public.activity (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references auth.users on delete cascade,
  entry_id   uuid not null references public.library_entries on delete cascade,
  session_id uuid references public.reading_sessions on delete cascade,
  kind       text not null check (kind in ('want', 'started', 'finished', 'abandoned', 'reviewed')),
  on_day     date,
  created_at timestamptz not null default now(),
  visible_at timestamptz not null
);
create index activity_feed on public.activity (member_id, visible_at desc, id desc);
create index activity_entry on public.activity (entry_id);
-- RLS on, no grants.
```

### 1.3 How activity is written (D3)

Triggers in `private`, `security definer`, `set search_path = ''`, each wrapped so that a failure
raises a `warning` and never fails the library write (as `private.shelf_publish_on_session`):

| Trigger | Fires on | Writes |
|---|---|---|
| `reading_sessions_activity` | `after insert` | `started` (outcome null; `on_day` = `started_on`), `finished` / `abandoned` (inserted closed; `on_day` = `ended_on`) |
| same | `after update of outcome` (null → finished/abandoned) | `finished` / `abandoned`, `on_day` = `ended_on` |
| same | `after update of review` (`OLD.review` null → text, **`OLD.outcome` already `finished`**, so not the finishing update itself, and the session's `finished` row is already visible) | `reviewed`, `on_day` = `ended_on` |
| `library_entries_activity` | `after insert` (not deferred: a deferred trigger would fire after an import returned, outside its quiet setting) | `want`, written with `created_at = statement_timestamp()`; `on_day` = `added_at::date`. A session inserted **in the same statement** (`add_to_library` with a status) deletes that `want` row before writing its own |

Rules, in the trigger before inserting, in this order:

0. **Same statement**: a session's trigger first deletes its entry's `want` row written in the same
   statement (`created_at = statement_timestamp()`), whatever it then writes or not.
1. **Quiet**: nothing when `auth.uid()` is null (service role, the owner's scripts), when
   `current_setting('libellus.quiet', true) = 'on'`, or when the call stack
   (`get diagnostics … = pg_context`, checked last because it costs the most) shows
   `public.import_books(`. (A function-level `set libellus.quiet` was the first plan; since Postgres 15
   it needs superuser rights to set a custom parameter on a function, which Supabase's `postgres` role
   has not, locally or hosted. The call stack also survives a later `create or replace` of the import.)
   `import_book_for` needs nothing: it only finds or makes Book rows, never entries or sessions.
2. **Old news**: no `finished`/`abandoned` when `ended_on` is null or earlier than
   `(now() at time zone 'utc')::date - 14`.
3. **Settle**: `visible_at = now() + (select settle_window from private.social_config)`. Before
   inserting, delete the rows still inside their window (`visible_at > now()`) **of the same session**,
   and the entry's `want` row if it is still inside its window: a correction replaces what was written
   (want → started, started → finished, started → abandoned), but a finished read stays when she starts
   it again. `reviewed` never replaces `finished`; it is written only once the finish is visible.
4. **Once**: at most one row per (`session_id`, `kind`).

`purge_activity()` (in `private`): deletes rows with `created_at < now() - interval '13 months'`,
scheduled `purge-activity` daily 03:45 UTC where pg_cron exists (as `purge_synced_writes`).

### 1.4 Shared shapes

**Card** (a member as others see her):

```json
{ "id": "uuid", "name": "Anna" | null, "photo": "<id>/<hash>.webp" | null }
```

`name`: `user_metadata.name` (the first name the app asks for), trimmed, cut at 40 characters, null
when empty. `photo`:
`accounts.avatar_path` when `public.can_see_member_photo(id)` is true for the caller, else null. Never
the address.

**Book** (`private.social_book_json(books)`): `private.reading_page_book_json`'s keys plus
`"manual": true|false` (a Manual book: a follower cannot open it).

**Sections**: `{ "reading", "want", "finished", "ratings", "reviews", "abandoned", "year" }`, all
booleans.

**Reachable**: the owner is reachable for the caller when she is not the caller, neither blocked the
other, and one of: her account is public; the caller follows her or asked to (declined included); she
follows the caller or asked to; the caller opened her link (`follow_link_views`).

**Visible** (her reading): reachable, and her account is public or the caller follows her (accepted).
A request still waiting sees nothing.

### 1.5 Functions

All `security definer`, granted to `authenticated` only, refusing `not_signed_in` without a member.

#### D1: her own settings

| Function | Returns | Does |
|---|---|---|
| `my_social()` | `MySocial` | Makes her row if missing (with a fresh token). |
| `set_private(p_private boolean)` | `MySocial` | Going public (`false`) accepts every waiting request that is not declined and **deletes the declined ones** (on a public account a lone "requested" would tell the asker he was declined; deleting rather than accepting keeps her decline: he may follow like anyone else now). |
| `set_social_sections(p_sections jsonb)` | `MySocial` | Only the keys of *Sections*; unnamed keys keep their value; else `social_sections_invalid`. |
| `renew_follow_link()` | `MySocial` | A new token; the old one answers `null` in `follow_target`. Deletes the `follow_link_views` rows of her visitors who have no follow or request with her either way: who only opened the old link is forgotten. |
| `set_entry_hidden(p_entry uuid, p_hidden boolean)` | `void` | `entry_not_found` for an entry not hers. A hidden entry is gone for everyone but her: also from her public reading page and its Book cards (`private.reading_page_*`, `public_book_card`). Also an action of `sync_write` (`set_entry_hidden`, args `{ p_entry, p_hidden }`): the migration re-creates `sync_write` from its latest version (`20261010120000_reader_highlights.sql`), **copying the whole body** and adding one `when` branch. |
| `can_see_member_photo(p_owner uuid)` | `boolean` | True for herself, and when `p_owner` is reachable for the caller. Lives in `public` (policies cannot call into `private`), `stable`. |

```json
// MySocial
{ "private": true, "sections": { …Sections }, "link": "<22-char token>", "requests": 0 }
```

`requests`: the number of requests to her that are neither accepted nor declined (D2 makes it
non-zero; D1 returns the count from `follows`).

#### D2: following

| Function | Returns | Does |
|---|---|---|
| `follow_target(p_token text)` | `FollowTarget` or `null` | `null` for a malformed, unknown or renewed token and when either blocked the other. Otherwise records `(member, her)` in `follow_link_views`. Her own token: `state = 'self'`. |
| `follow(p_member uuid)` | `{ "state": "following" \| "requested" }` | In this order: `follow_self`; `not_found` unless the owner is reachable; the rate limit; the follow limits (§1.1). Already following: `following`, nothing changes. **Public** owner: `following` at once (a declined or waiting request of the caller's is turned into the follow). **Private** owner: a request, `requested`, **also when she already follows the caller** (following back asks, owner's decision, social-v1.md B 9). Already asked, declined or not: `requested`, nothing changes. Logs the call in `private.follow_calls`. |
| `withdraw_request(p_member uuid)` | `void` | Deletes the caller's request to the owner (declined or not). Nothing to delete: no error. |
| `answer_request(p_member uuid, p_accept boolean)` | `void` | On a request from `p_member` to the caller that is neither accepted nor declined: accept sets `accepted_at`, decline sets `declined_at`. Any other case (none, accepted, declined): `not_found`. A decline is final until the asker withdraws and asks again. |
| `unfollow(p_member uuid)` | `void` | Deletes the caller's follow or request to the owner. |
| `remove_follower(p_member uuid)` | `void` | Deletes `p_member`'s follow or request to the caller. |
| `block(p_member uuid)` | `void` | `follow_self` for herself; `not_found` unless `p_member` is reachable for the caller or already blocked by her (an unknown id must not tell a stranger whether it is a member). Deletes follows and requests both ways, inserts `blocks` (once), deletes both `follow_link_views` rows. |
| `unblock(p_member uuid)` | `void` | Deletes the caller's block of `p_member`; nothing to delete: no error. Follows do not come back. |
| `my_people()` | `People` | |
| `my_blocked()` | `Card[]` | Newest block first. `photo` is null here (a block hides photos both ways). |

```json
// FollowTarget
{ "member": Card, "private": true, "state": "self" | "none" | "requested" | "following" }

// People: each list ordered by name (nulls last), then id
{
  "following": [Card],                                      // she accepted
  "followers": [Card & { "followsBack": true|false }],      // accepted follows of the member
  "requests":  [Card & { "askedAt": "timestamptz" }],       // to the member, pending, not declined; newest first
  "requested": [Card]                                       // the member's own pending asks (declined ones too)
}
```

#### D4: reading what others read

| Function | Returns | Does |
|---|---|---|
| `feed(p_before timestamptz default null, p_before_id uuid default null, p_limit integer default 30)` | `FeedEntry[]` | Rows of owners the caller follows (accepted, not blocked either way), `visible_at <= now()`, not hidden, kind allowed by the owner's switches; ordered `visible_at desc, id desc`; keyset `(visible_at, id) < (p_before, p_before_id)`; `p_limit` clamped to 1–50. `FeedEntry.id` is `activity.id`. |
| `member_profile(p_member uuid)` | `MemberProfile` or `null` | `null` unless reachable (the caller herself: `null` too; the app shows her own Profile). |
| `member_want(p_member uuid)` | `[{ "book": Book, "addedOn": "date" }]` or `null` | *See all* under Want to read: every Want to read entry, newest first, not hidden. `null` unless visible and `show_want`. |
| `member_reading_record(p_member uuid)` | `MemberRecord` or `null` | `null` unless visible and `show_year`. |

Kind → switch: `started` → `show_reading`; `want` → `show_want`; `finished` → `show_finished`;
`abandoned` → `show_abandoned`; `reviewed` → `show_reviews` and `show_finished`. In every answer
(feed, profile, record): `rating` is null unless `show_ratings`; `review` is null unless `show_reviews`;
`again` is false unless `show_finished` (it would tell of an earlier finish); an abandon reason,
progress, reading days, highlights, notes, collections, the address and hidden Books never appear.

```json
// FeedEntry
{
  "id": "uuid", "at": "timestamptz (visible_at)", "member": Card,
  "kind": "started" | "finished" | "abandoned" | "want" | "reviewed",
  "again": false,            // started: the entry has an earlier finished read
  "day": "2026-10-09" | null, // on_day
  "book": Book,
  "rating": 18 | null,       // quarters, finished and reviewed only
  "review": "text" | null    // finished and reviewed only
}

// MemberProfile when not visible (a private account the member does not follow)
{ "member": Card, "private": true, "state": FollowState, "visible": false }

// MemberProfile when visible ("private": the owner's real setting: a follower of a private account gets this too)
{
  "member": Card, "private": true, "state": FollowState, "visible": true,
  "followsYou": true,
  "sections": Sections,
  "since": "2025-03-01" | null,              // earliest start or end of a closed, not hidden read
  "counts": { "read": 42, "reading": 2, "want": 17 },   // entries (not reads): read = with a finished read; reading = with an open read; want = Want to read. Hidden left out; a count whose section is off: null (read ← show_finished)
  "reading":  [{ "book": Book, "startedOn": "date" }],               // ≤ 6, newest start first; [] when off
  "want":     [{ "book": Book, "addedOn": "date" }],                 // ≤ 12, newest first; [] when off
  "finished": [{ "book": Book, "endedOn": "date"|null, "rating": 18|null, "review": "…"|null }] // ≤ 12, latest finished read per Book; [] when off
}

// MemberRecord: exactly the rows data/stats.ts reads for her own Profile
{
  "reads": [SessionStatsRow],   // closed reads of entries not hidden: finished ones only with show_finished, abandoned only with show_abandoned; rating null without show_ratings
  "wantToRead": 17,             // null without show_want; hidden left out
  "reading": 2                  // null without show_reading; hidden left out
}
// SessionStatsRow = { id, entry_id, started_on, ended_on, outcome, rating, created_at,
//                     entry: { page_count_override, book: { exactly the columns BookRow
//                     (web/app/data/library.ts) has: id, title, authors, isbn13, isbn10, page_count,
//                     published_year, language, publisher, description, cover_url, cover_thumbhash,
//                     cover_dominant, cover_secondary, source, apple_id, openlibrary_edition_key,
//                     openlibrary_work_key, format, created_at; "goodreads": null } } }  (never owner_id)
```

Avatars (D4): a new select policy on `storage.objects`, named `avatars_select_connected`:
`bucket_id = 'avatars' and public.can_see_member_folder((storage.foldername(name))[1])`, where
`public.can_see_member_folder(p_folder text) returns boolean` (D4, `stable`, definer) answers false for
anything that is not a uuid (no cast in the policy: a bad folder name must not throw) and
`can_see_member_photo` otherwise.

### 1.5a Hardening and accepted risks (gate 1)

After the four migrations, a leak review (gate 1) found two holes, closed by
`20261017050000_social_hardening.sql` and `supabase/tests/social_hardening_test.sql`: the declined
request on an account gone public (`set_private`, above) and hidden Books on the public reading page
(`set_entry_hidden`, above). The same migration closes two races (`follow` reads the owner's
`social_settings` row `for share`, so `set_private` waits for it; `follow` and `block` take an advisory
transaction lock on the sorted pair of members), names the record's Book column by column, and puts
`private.social_config` and `private.follow_calls` behind RLS.

Accepted, on purpose:

- **A public account can be confirmed by its id**: `follow` and `block` succeed on it and answer
  `not_found` for an unknown id. Being public means being reachable; ids are random 128-bit uuids a
  stranger never sees, and private accounts stay indistinguishable from non-members.
- **A declined member can withdraw and ask again**, at most 30 calls an hour. Block is the answer.
- **A removed follower who still has the link** sees her card and can ask again; a new link is the
  real removal (the app's Remove confirm offers it).
- **People lists have no paging**: fine for a circle; revisit before public accounts grow to thousands.
- **Unhiding a Book brings its old activity back** with its dates, as switching a section back on does.
- **`purge-activity` is only scheduled where pg_cron exists**, as `purge-synced-writes` is.

**Gate 2** (a privacy review of the whole of social v1: no critical or high leak) closed four more points in
`20261015060000_social_gate2.sql`, with their tests in the `social_*_test.sql` files:

- **A Manual book's cover is no tracking pixel.** `cover_url` of a member's own Book is any `https://` URL she
  typed, and a follower's browser would fetch it when the feed opens. `private.cover_shown(book)` lets a cover
  of such a Book (with its thumbhash and colours) reach others only on `covers.openlibrary.org`,
  `*.mzstatic.com` or `books.fabkho.dev`, the hosts the app's own sources use (no Storage bucket holds a
  cover); else null and the follower sees the cloth Placeholder. Every path goes through it: the feed,
  `member_profile` and `member_want` (`social_book_json`), the public reading page and its cards
  (`reading_page_book_json`), and the record's Book in `member_reading_record`.
- **`follow` and `block` cannot race.** `follow` checks `blocked_either` and `reachable` again once it holds
  the pair's lock, so a block committed while it waited is not followed through (`not_found`).
- **A photo, not the folder.** `avatars_select_connected` now calls `can_see_member_file(name)`: only the
  member's current photo (`accounts.avatar_path`) and its `-128` twin, not the older photos still in her folder.
- **A `reviewed` row needs its review.** The feed leaves out a `reviewed` row whose session's review has been
  cleared, instead of "reviewed X" with no text (only the feed hands out `activity` rows).

Accepted, on purpose (gate 2):

- **Going public deletes declined requests**, so a declined asker sees Follow rather than Following; he can now follow anyway.
- **A second account can tell "blocked" from "private"**, as on Instagram; only the blocker is learned.
- **A queued Hide from followers takes effect when it syncs**: until the device is online the Book stays visible.
- **Cloudflare (the host) sees page paths** such as `/f/<token>` in its logs and its analytics, as it already does for reading pages.

### 1.6 The database tests

Written by the orchestrator before the tasks (step 0.2), in `supabase/tests/`:
`social_settings_test.sql` (D1), `social_follows_test.sql` (D2), `social_activity_test.sql` (D3),
`social_readers_test.sql` (D4). A task makes its file pass and keeps the whole suite green. It may
correct a `plan(n)` count and nothing else in them; anything it thinks is wrong in a test is a
question to the orchestrator.

---

## 2. Data layer (`web/app/data/`)

Framework-free, as every repository: the client and `{ online }` passed in, every write refused
offline with `offline` before anything is sent, database refusals mapped to their code.

**Shared shapes: `web/app/data/socialShapes.ts`** (written by the orchestrator before W1–W3, so the
three can work in parallel): `SocialErrorCode`, `SocialResult<T>`, `mapSocialError`, `MemberCard` +
`cardFromJson`, `SocialBook` + `socialBookFromJson` (`year`, as `Book` names it), `SocialSections` +
`SOCIAL_SECTIONS`, `FollowState`, `MemberProfile`. The repositories import them from there and do not
redefine them; `data/social.ts` re-exports them for the stores.

```ts
// data/social.ts (W1)
export type SocialErrorCode = 'offline' | 'not_signed_in' | 'not_found' | 'follow_self' | 'follow_limit'
  | 'rate_limited' | 'social_sections_invalid' | 'entry_not_found' | 'unknown'
export type MemberCard = { id: string; name: string | null; photo: string | null }
export type SocialSections = { reading: boolean; want: boolean; finished: boolean; ratings: boolean
  reviews: boolean; abandoned: boolean; year: boolean }
export type MySocial = { private: boolean; sections: SocialSections; link: string; requests: number }
export type FollowState = 'self' | 'none' | 'requested' | 'following'
export type FollowTarget = { member: MemberCard; private: boolean; state: FollowState }
export type People = {
  following: MemberCard[]
  followers: (MemberCard & { followsBack: boolean })[]
  requests: (MemberCard & { askedAt: string })[]
  requested: MemberCard[]
}
export interface Social {
  mine(): Promise<Result<MySocial, SocialErrorCode>>
  setPrivate(on: boolean): Promise<Result<MySocial, SocialErrorCode>>
  setSections(sections: Partial<SocialSections>): Promise<Result<MySocial, SocialErrorCode>>
  renewLink(): Promise<Result<MySocial, SocialErrorCode>>
  target(token: string): Promise<Result<FollowTarget | null, SocialErrorCode>>
  follow(member: string): Promise<Result<'following' | 'requested', SocialErrorCode>>
  withdraw(member: string): Promise<Result<void, SocialErrorCode>>
  answer(member: string, accept: boolean): Promise<Result<void, SocialErrorCode>>
  unfollow(member: string): Promise<Result<void, SocialErrorCode>>
  removeFollower(member: string): Promise<Result<void, SocialErrorCode>>
  block(member: string): Promise<Result<void, SocialErrorCode>>
  unblock(member: string): Promise<Result<void, SocialErrorCode>>
  people(): Promise<Result<People, SocialErrorCode>>
  blocked(): Promise<Result<MemberCard[], SocialErrorCode>>
  profile(member: string): Promise<Result<MemberProfile | null, SocialErrorCode>>
  /** Her whole Want to read (the profile's See all); null when not visible or switched off. */
  want(member: string): Promise<Result<{ book: SocialBook; addedOn: string }[] | null, SocialErrorCode>>
}
export function createSocial(client: SupabaseClient, options: { online: () => boolean }): Social
/** `https://<site>/f/<token>`: the link the share sheet hands out. */
export function followLink(origin: string, token: string): string

// MemberProfile, SocialBook, MemberCard, …: from data/socialShapes.ts (above).

// data/feed.ts (W2)
export type FeedKind = 'started' | 'finished' | 'abandoned' | 'want' | 'reviewed'
export type FeedEntry = { id: string; at: string; member: MemberCard; kind: FeedKind; again: boolean
  day: string | null; book: SocialBook; rating: number | null; review: string | null }
export type FeedRow =
  | { type: 'entry'; entry: FeedEntry }
  | { type: 'batch'; member: MemberCard; kind: FeedKind; day: string | null; entries: FeedEntry[] }
export type FeedDay = { day: string; rows: FeedRow[] }    // `day`: the member's own calendar day of `at`
export const FEED_PAGE = 30
export const BATCH_FROM = 3                                // 3 or more of one kind, one member, one day
export const FEED_KEEP_DAYS = 7                            // the device's copy, at most this old
/** Pure: entries (newest first) → days → rows, batches folded. */
export function feedDays(entries: readonly FeedEntry[], timeZoneDay: (at: string) => string): FeedDay[]
export interface Feed {
  page(before?: { at: string; id: string }): Promise<Result<FeedEntry[], SocialErrorCode>>
}
export function createFeed(client: SupabaseClient, options: { online: () => boolean }): Feed
// The device's copy: readFeed(storage, memberId, now) / saveFeed(storage, memberId, entries, now),
// under `libellus.feed` (signing out clears the prefix), null when older than FEED_KEEP_DAYS.

// data/memberStats.ts (W3)
export function createMemberStats(client: SupabaseClient): {
  record(member: string): Promise<Result<{ reads: StatsRead[]; wantToRead: number; reading: number } | null, SocialErrorCode>>
}
// reads come from data/stats.ts' readsFromRows, unchanged; figures from figuresOf, unchanged.
```

`set_entry_hidden` belongs to the Library's writes: `setHidden(entry, hidden, options)` in
`data/library.ts` beside `setReadAs`, queueable (`queuedWrites.ts`: action `set_entry_hidden`, the
sync sheet's label `sync.action.set_entry_hidden`), applied to the device's copy at once (W3).

---

## 3. Routes and screens

| Route | Page | Meta | Task |
|---|---|---|---|
| `/friends` | `pages/friends/index.vue` | `layout: 'tabs', screen: 'friends', pushed: true` | U5 |
| `/friends/people` | `pages/friends/people.vue` | `layout: 'tabs', screen: 'people', pushed: true` | U3 |
| `/friends/<member>` | `pages/friends/[member]/index.vue` | `layout: 'tabs', screen: 'member', pushed: true`, `validate`: a uuid | U4 |
| `/friends/<member>/<year>` | `pages/friends/[member]/[year].vue` | `layout: 'tabs', screen: 'memberYear', pushed: true`, four-digit year | U4 |
| `/f/<token>` | `pages/f/[token].vue` | resolves the token, then `replace` to `/friends/<member>` (or `/profile` for her own, or the missing state) | U2 |

Signed out, `/f/<token>` is kept on the device like a share (`utils/pendingShare.ts`'s pattern, a key
of its own, `libellus.pendingFollow`) and opened once she is signed in (`middleware/auth.global.ts`).
The error log reports `/friends/[member]` and `/f/[token]`, never the id or token (W5).

## 4. Test ids

Every interactive element and everything a test reads, as `<screen>.<element>`:

- **Home** (`components/home/Circle.vue`, `CircleFeature.vue`, `CircleFriend.vue`): `home.circle`,
  `home.circleRequest`, `home.circleAccept`, `home.circleDecline`; the card of a finished Book
  `home.circleFeature` (`.member`, `.cover`, `.title`, `.stars`, `.review`, `.more`); a member's
  row `home.circleFriend`; `home.circleTitle` (the title, a link to the feed); `home.circleMore`. (`home.circleEntry` and `home.circleBatch` are gone: the
  rows are one per member, a batch is a phrase of her sentence.)
- **Feed** (`/friends`): `friends`, `friends.back`, `friends.people`, `friends.day`, `friends.entry`,
  `friends.entryMember`, `friends.entryBook`, `friends.entryReview`, `friends.entryMore`,
  `friends.batch`, `friends.empty`, `friends.emptyShare`, `friends.quiet`, `friends.offline`,
  `friends.loadError`, `friends.retry`; the batch sheet `friendsBatch` (`.sheetTitle`, `.cancel`,
  `.row`).
- **People** (`/friends/people`): `people`, `people.back`, `people.status` (the page's polite status), `people.segment.following|followers|requests`,
  `people.row`, `people.rowMore`, `people.accept`, `people.decline`, `people.followBack`,
  `people.empty`; the member sheet `memberSheet` (`.unfollow`, `.remove`, `.block`, `.cancel`); the
  block confirm `blockConfirm` (`.confirm`, `.cancel`).
- **Member** (`/friends/<member>`; *See all* opens the sheet `memberWant` with `.sheetTitle`, `.cancel`, `.row`, `.book`; *See all* under Recently finished the sheet `memberFinished`, the same): `member`, `member.back`, `member.more`, `member.hero`,
  `member.name`, `member.since`, `member.library`, `member.follow`, `member.ask`, `member.requested`,
  `member.status` (the page's polite status), `member.private`, `member.reading`, `member.want`, `member.wantAll`, `member.finished`,
  `member.finishedAll` (only above 3 finished Books), `member.finishedCover` (the cover's link, hidden from the keyboard and screen readers: the title's is the Book's one), `member.finishedBook` (the title's link), `member.finishedTitle`, `member.finishedReview`, `member.finishedMore`, `member.yearCards`, and the Profile's own figure ids inside
  (`profile.figures`, `profile.columns`, …, as the reused components carry them);
  `memberYear` (`.back`, `.title`) for the year page.
- **Follow link** (`/f/<token>`): `follow`, `follow.loading`, `follow.missing`.
- **Profile** (`components/profile/Friends.vue`): `profile.friends`, `profile.circle`, `profile.people`,
  `profile.peopleValue`, `profile.followLink`, `profile.privacy`, `profile.privacyValue`.
- **Privacy sheet**: `privacy` (`.cancel`), `privacy.private`, `privacy.section.reading|want|finished|ratings|reviews|abandoned|year`,
  `privacy.blocked`, `privacy.error`; going public confirm `goPublic` (`.confirm`, `.cancel`).
- **Follow link sheet**: `followLink` (`.cancel`), `followLink.value`, `followLink.share`,
  `followLink.copy`, `followLink.renew`, `followLink.outcome`; renew confirm `renewFollowLink`
  (`.confirm`, `.cancel`).
- **Blocked sheet**: `blocked` (`.cancel`), `blocked.row`, `blocked.unblock`, `blocked.empty`, `blocked.status` (polite).
- **Book options**: `bookOptions.hide` (the switch row).
- **Header**: `shell.avatarDot` (the lamp dot while a request waits).

## 5. Strings (`web/i18n/locales/en.json`, W4)

New keys (English as written; `{name}` etc. are i18n parameters):

```json
{
  "circle": {
    "title": "Your circle",
    "more": "Show more",
    "askedLine": "asked to follow you",
    "want": "added {title} to Want to read",
    "join": " · ",
    "and": " and ",
    "accept": "Accept",
    "decline": "Decline",
    "declineLabel": "Decline {name}",
    "acceptLabel": "Accept {name}"
  },
  "feed": {
    "title": "Your circle",
    "peopleLabel": "People",
    "started": "started",
    "startedAgain": "started again",
    "finished": "finished",
    "abandoned": "didn't finish",
    "want": "added to Want to read",
    "reviewed": "reviewed",
    "batchFinished": "finished {count} books",
    "batchStarted": "started {count} books",
    "batchAbandoned": "didn't finish {count} books",
    "batchWant": "added {count} to Want to read",
    "batchTitle": "{name} · {count} books",
    "more": "More",
    "today": "Today",
    "yesterday": "Yesterday",
    "emptyTitle": "Reading is better with a friend or two.",
    "empty": "Send your follow link to the people you'd like here. What they start and finish will show up on this page.",
    "emptyShare": "Share your follow link",
    "quietTitle": "Quiet for now.",
    "quiet": "When the people you follow start or finish a book, it shows here.",
    "offline": "Offline · as of {time}",
    "loadOffline": "You're offline. Your circle shows once you're back.",
    "loadError": "Your circle couldn't be loaded.",
    "retry": "Try again"
  },
  "people": {
    "title": "People",
    "following": "Following",
    "followers": "Followers",
    "requests": "Requests",
    "askedOn": "asked {when}",
    "followsYouNow": "follows you now",
    "accepted": "{name} follows you now.",
    "declined": "Request from {name} declined.",
    "accept": "Accept",
    "decline": "Decline",
    "acceptLabel": "Accept {name}",
    "declineLabel": "Decline {name}",
    "followBack": "Follow back",
    "moreLabel": "More for {name}",
    "emptyFollowing": "You don't follow anyone yet.",
    "emptyFollowers": "Nobody follows you yet.",
    "unfollow": "Unfollow",
    "remove": "Remove as follower",
    "block": "Block",
    "sheetNote": "{name} isn't told. Block also stops {name} following you again or opening your link.",
    "blockTitle": "Block {name}?",
    "blockText": "You stop following each other, and neither of you sees the other's reading.",
    "blockConfirm": "Block",
    "offline": "You're offline. People show once you're back.",
    "loadError": "People couldn't be loaded. Try again."
  },
  "member": {
    "back": "Back",
    "moreLabel": "More",
    "since": "Reading here since {month}",
    "library": "{read} read · {reading} reading · {want} to read",
    "follow": "Follow",
    "ask": "Ask to follow",
    "requested": "Requested",
    "following": "Following",
    "withdrawn": "Request withdrawn.",
    "requestedHint": "Tap to withdraw.",
    "privateTitle": "Private account",
    "privateText": "Ask to follow to see what {name} reads. {name} decides; nobody else is told.",
    "reading": "Currently reading",
    "want": "Want to read",
    "wantAll": "See all",
    "finished": "Recently finished",
    "years": "Years in review",
    "yearEyebrow": "{name} · Year in review",
    "someone": "A reader"
  },
  "follow": {
    "loading": "Opening…",
    "missingTitle": "This link isn't here any more.",
    "missing": "Ask for a new one."
  },
  "friends": {
    "section": "Friends",
    "people": "People",
    "peopleRequests": "No requests | 1 request | {count} requests",
    "followLink": "Your follow link",
    "privacy": "Privacy",
    "private": "Private",
    "public": "Public"
  },
  "privacy": {
    "title": "Privacy",
    "done": "Done",
    "private": "Private account",
    "privateHint": "You approve each follower. Turn it off and any member with your link can follow you and see what's switched on below.",
    "sections": "What followers see",
    "section": {
      "reading": "Currently reading",
      "want": "Want to read",
      "finished": "Finished",
      "ratings": "Ratings",
      "reviews": "Reviews",
      "abandoned": "Did not finish",
      "year": "Year in review and figures"
    },
    "never": "Your reasons for not finishing, your progress and your notes are never shown. Hide a single Book in its options.",
    "blocked": "Blocked",
    "blockedNone": "None",
    "goPublicTitle": "Make your account public?",
    "goPublicText": "Any member with your link can follow you without asking. People waiting for an answer become followers now.",
    "goPublicConfirm": "Make public",
    "error": "That didn't save. Try again."
  },
  "followLink": {
    "title": "Your follow link",
    "textPrivate": "Send it to friends in Libellus. Your account is private, so they ask and you decide.",
    "textPublic": "Send it to friends in Libellus. Your account is public, so they can follow you straight away.",
    "offline": "You're offline. Your link shows once you're back.",
    "share": "Share link",
    "copy": "Copy",
    "copied": "Copied.",
    "renew": "New link",
    "renewHint": "A new link stops the old one at once. People who already follow you stay.",
    "renewTitle": "Make a new link?",
    "renewText": "The link you sent before stops working.",
    "renewConfirm": "New link",
    "shareText": "Follow what I read on Libellus"
  },
  "blocked": {
    "title": "Blocked",
    "unblock": "Unblock",
    "unblockLabel": "Unblock {name}",
    "unblocked": "{name} unblocked.",
    "empty": "You haven't blocked anyone."
  },
  "bookOptions": { "hide": "Hide from followers", "hideHint": "Hidden from your followers: not in their feed, not on your profile, not in the figures they see." },
  "sync": { "action": { "set_entry_hidden": "Visibility to followers" } },
  "shell": { "avatarRequest": "Your profile, a follow request is waiting" }
}
```

(`bookOptions`, `sync.action` and `shell` exist: the keys above are added inside them.)

Changed keys:

| Key | New English |
|---|---|
| `photo.private` | "You and the members you're connected to see it: who follows you, who you follow, who asked to, who opened your follow link, and everyone in Libellus while your account is public. It's saved small, without where or when it was taken." |
| `manual.private` | "It stays out of the shared catalogue. Your followers see it with your reads; hide it from them in the Book's options." |
| `ownEdition.private` | "Your edition stays out of the shared catalogue. Your followers see it with your reads; hide it from them in the Book's options." |
| `profile.deleteAccount.text` | "This permanently deletes your Library, reading sessions, ratings, reviews, collections, your name and photo, who you follow and who follows you, and your sign-in. It can't be undone." |
| `sharing.about` | its current text, plus one sentence: "Your followers in the app see what you choose under Friends → Privacy." |

## 6. The one flow (E1)

`web/e2e/friends.spec.ts`: one test, two members made by the existing fixtures (`signedIn`), each in a browser
context of her own (Ida's is the test's `page`, Anna's a second context with the project's device options); the
settle window is set to zero through the database in `beforeAll` and back to ten minutes in `afterAll`
(`update private.social_config set settle_window = …`, with `sql` from `tests/support/stack.ts`), so a failure
restores it too. Steps:

1. Ida (private by default): Profile → Your follow link; the link is read from `followLink.value`, Copy says "Copied."
2. Anna opens the link (`goto`): it lands on Ida's page, the private card (`member.private`), Ask to follow →
   `member.requested`.
3. Ida's Home shows the request in Your circle (`home.circleRequest`); Accept (`home.circleAccept`) answers it.
4. Ida finishes a Book today with 4.5 stars and a review (the Library's API, `addToLibrary` with `status: 'finished'`,
   as a11y's seed does; the UI's finish is core-loop's).
5. Anna's Home shows it as the lit card (`home.circleFeature`: `.member`, `.title`, `.stars`, `.review`); Your circle's
   title (`home.circleTitle`) opens the feed (one `friends.entry`); Ida's name (`friends.entryMember`) opens her page, the
   Book under Recently finished (`member.finishedTitle`).
6. Ida hides the Book (Library → Finished → the Book → ⋯ → Hide from followers, `bookOptions.hide`); Anna's feed, her
   Home card and Ida's page no longer show it.
7. Ida blocks Anna (Profile → People → Followers → ⋯ → Block → confirm); Anna's Your circle is gone and the link
   answers "This link isn't here any more" (`follow.missing`).

The new screens join `a11y.spec.ts`, dark only, `@full`: one test that makes Anna, Ida (a finish with a review, an older
one), Cleo (a wanted Book) and Ben (a request to follow Anna), settles their activity by its own `visible_at` (so it does
not depend on the window the social flow sets), and scans Home with Your circle, the feed, People (requests and
following), the member sheet, a member, her year, a private follow link's card and Privacy.

## 7. Parity outline (E2)

New entries in `docs/parity.md`, each in the file's template: *Your circle on Home*, *The feed*, *A
batch*, *People*, *Follow requests*, *A member's profile*, *A member's year in review*, *Follow
link*, *Privacy*, *Blocked*, *Hide from followers*. Changed: *Profile* (the Friends section),
*Profile photo* (who sees it), *Manual book sheet* and *My edition isn't listed* (the copy), *Delete
account* (what goes), *Save offline and sync later* (the new queueable write), *Reading page* (its
"without a social network").
