# Proposal: social features for a small, private circle

> **Decided since:** the owner answered §10's questions on 8 October 2026. The scope of version 1,
> its mocks and a proposed version 2 are in [social-v1.md](social-v1.md), which wins where the two
> differ (most visibly: accounts are private by default and public ones can be followed without
> asking, as on Instagram; reviews and Did not finish are shown by default).

Status: **proposal, nothing built.** This document changes no code, table or test. It is for the
owner to decide on (§10 ends with the questions he has to answer first); each slice of the roadmap
then becomes its own `ready-for-agent` issue.

**What changes in the product's stance.** The spec round of October 2026 (#166) said *"no social
network: no feeds, follows or likes"*, and SPEC.md still lists *"social features (friends, feed,
likes, follows)"* as a non-goal and decides *"Sharing is a link, not a network"* (SPEC.md §1 and §8).
The owner is now deliberately reversing that for **follows, member profiles and a feed of the people
you follow**. What still holds, and what this proposal is built around:

- **Invite-only.** Every person who can follow anyone is a Member of this one instance, let in with
  an invite code (`supabase/migrations/20261002190000_invites_and_accounts.sql`). There is no public
  discovery, no directory of strangers, no search engine ever sees a member.
- **No ads, no tracking, no growth hacks.** No counts to chase (followers, likes, streaks), no
  "people you may know", no nudges to post, no notifications about other people's reading.
- **Rules live in the database.** Who may see what is decided by RLS and security-definer functions,
  as everything else here is (web/AGENTS.md, "Rules live in the database"), never by the client.
- **The public reading page stays what it is** (#171): a link a member hands out, readable by
  anyone, off by default. Following is a second, separate audience: members she lets in.

§9 lists every promise in README.md, SPEC.md, CONTEXT.md, parity.md and the app's copy that has to
be rewritten when the first slice lands.

---

## 1. Where we are

### What exists that is social-ish

| Thing | Where | Who sees it |
|---|---|---|
| **Reading page** `/r/<token>` and **Book cards** `/r/<token>/book/<id>` | `supabase/migrations/20261011030000_reading_pages.sql`, `web/app/pages/r/[token]/*`, `components/profile/Sharing.vue`, `stores/sharing.ts`, `data/readingPage.ts` | Anyone with the link, signed in or not. Off by default; five section switches (`show_reading`, `show_year`, `show_favourites`, `show_finished`, `show_shelf`); reviews only per Book (`reading_page_books.review`). Read only through `public_reading_page(token)` / `public_book_card(token, book)` (security definer, granted to `anon`), which answer `null` ("not found, never forbidden") for anything not published. |
| **Waitlist** | `20261011040000_waitlist.sql`, `20261013010000_waitlist_invite.sql` | `private.waitlist`, readable only by the member in `private.instance_owner`. It is the only place a member is linked to another person: `source_member_id`, "whose page she came from". |
| **First name** | `user_metadata.name`, set by `auth.updateUser` (`setName` in `web/app/data/auth.ts`, `components/shell/NameSheet.vue`) | Only her (the greeting, the avatar's initials) and visitors of her reading page through `private.reading_page_name(member)`, which reads `auth.users.raw_user_meta_data ->> 'name'`. No table, no uniqueness; `cleanName` (≤ 40 characters) runs in the client only, so a server-side reader must cap it itself. |
| **Profile photo** | private bucket `avatars`, `accounts.avatar_path`, `set_avatar` (`20261009120000_avatars.sql`) | Only her: the select policy `avatars_select_own` allows her own folder. The migration already says where the change goes: *"If photos are ever shown to other members, a policy for them goes here."* The copy says so too: `photo.private` = "Only you see it." |
| **Invite graph** | `accounts.invite_code_id → invite_codes(label)` | Nobody but the owner (`invite_codes` has no grant at all for members). Codes are made only by the owner (`create_invite_code`, granted to `service_role`; `owner_waitlist_prepare_invite`). So **there is no "who invited whom" between members**: every member was invited by the owner. The invite graph cannot be used to find friends. |
| **The shared Catalogue** | `books`, policy `books_readable` (`owner_id is null or owner_id = auth.uid()`) | Every member reads every Catalogue Book, but not who added it. Manual books (and a member's own edition, which is a Manual book) are readable by their owner only. |

### What we hold per member, and how it is kept private

All of it is behind RLS policies that compare the row's member with `(select auth.uid())`, with
`select` as the only grant and every write going through a `security definer` RPC:

- `library_entries` (`library_entries_own`): Book, Status (derived), `added_at`, `format_override`,
  `read_as`, `page_count_override`.
- `reading_sessions` (`reading_sessions_own`, through the entry): `started_on`, `ended_on`,
  `outcome`, `rating`, `review`, `abandon_reason`, `created_at`. **No `updated_at`:** the database
  knows the day she chose for a finish, not when she tapped Finish (relevant for §5).
- `reading_progress_days` (`reading_progress_days_own`), `reader_places`, `reader_highlights`
  (her selected sentences), `link_templates`, `entry_genres`, `entry_series`, `collections` and
  `collection_entries` (`collections_own`, `collection_entries_own`).
- `reading_pages`, `reading_page_books`, `synced_writes` (no policy at all, only `sync_write` reads it).
- `private.client_errors`: no content, but `route` is the raw `window.location.pathname`
  (`composables/useErrorLog.ts`, `scrubRoute` in `data/errorLog.ts` cuts only the query).
- On the device only: ebook files (OPFS), the Library copy (`libellus.library`), the stats copy
  (`saveStats`), the outbox (IndexedDB); all cleared on sign-out.

The `private` schema is closed to the API roles (`revoke all on schema private from public, anon,
authenticated`), so a policy can never call a helper in it (the avatars migration spells each policy
out for that reason). Owner-only functions check `private.is_instance_owner()`.

### How the Profile and the year in review are built today

`app/pages/profile/index.vue` and `app/pages/profile/[year].vue` read `stores/stats.ts`, which calls
`createStats(client).record(today)` in `app/data/stats.ts`: five plain table reads through RLS
(closed `reading_sessions` with `library_entries!inner(page_count_override, books!inner(…))`, two
head counts, `reading_progress_days`, the first day kept). Every figure is computed in the client
by pure functions (`readsFromRows`, `figuresOf`, `yearsOf`, `readsInMonth`, …). `SESSION_COLUMNS`
deliberately leaves out `review` and `abandon_reason`. This matters: **another member's figures can
be computed by the same functions if a definer RPC hands over rows of the same shape** (§4, §6).

---

## 2. Principles for a circle of friends

1. **Nothing changes until she turns it on.** The migration that adds following makes no member
   visible to anyone. Following her needs her consent: a link she hands out, or a request she
   accepts. Existing members start with followers off.
2. **A circle, not an audience.** No follower or following counts anywhere, no likes, no "popular",
   no rankings between friends, no read receipts ("seen"), no "people you may know".
3. **Calm.** The feed is pulled (opening it, pull to refresh), never pushed. No badge with a number
   on a tab; at most the lamp dot the design already uses for "lit now". No push notifications about
   what friends read (§8 keeps notifications for things addressed *to* you, later, if at all).
4. **Covers and figures, not sentences.** DESIGN.md's don'ts include "no text summaries of the
   reading". A feed row is a cover, a name, one verb ("finished"), stars and a mono date; never a
   generated paragraph. Batches are a fan of covers with a count, the way *Authors you return to*
   fans three covers.
5. **Privacy is decided when it is read, not when it is written.** A Book made private today hides
   last month's events too. Every read of someone else's data goes through one definer function that
   applies the follow, the block, her section switches and the per-Book switch together, the same
   way `public_reading_page` does, and answers "not found", never "forbidden".
6. **One tap makes a Book private.** On the Book's ⋯ sheet: *Hide from followers*. A private Book
   leaves no trace for anyone else: not in the feed, not on her profile, not in her figures, not in
   an overlap.
7. **Nothing is visible by accident.** A new event becomes visible after a short settle window
   (10 minutes), so a mistaken tap, a Start corrected to a DNF or a rating fixed right after the
   Finish never reaches anyone; imports and logging old reads produce no events at all (§5).
8. **Offline is honest.** Reading the circle needs the connection; the device shows the last feed it
   saw, dated. Writes that involve another member (follow, accept, remove, block) never wait in the
   outbox (§5, "Offline").
9. **The circle belongs to its members, not the owner.** The owner gains no new view into anyone's
   reading; he moderates by the means he already has (invites, the dashboard), §9.

---

## 3. The follow model

### Options

| | One-way follow, no consent (Letterboxd, Twitter) | **One-way follow with consent** (BookWyrm "Manually approve followers", Instagram private accounts) | Mutual friends (Goodreads friends, StoryGraph friends) |
|---|---|---|---|
| Mental model | "I watch her" | "She let me follow her" | "We are friends" |
| Fits a circle where not everyone knows everyone (the owner's friends, his girlfriend's friends) | No: any member sees every member | Yes | Yes |
| Asymmetric taste (she reads crime, he doesn't care) | Yes | Yes | No: friendship forces both feeds |
| Data | `follows(follower, followee)` | the same plus `accepted_at` | the same, two rows or one with a state |
| Precedent | — | BookWyrm: *"Anyone can just follow you … To limit this, … enable 'Manually approve followers'"* ([docs](https://docs.joinbookwyrm.com/privacy-controls.html)) | StoryGraph makes friends opt-in, default "Nobody can add me" ([help](https://thestorygraph.freshdesk.com/support/solutions/articles/79000141957)) |

**Recommendation: one-way follow with consent.** Consent comes in two ways:

- **Her follow link** (`/f/<token>`, below): handing it out *is* the consent, so whoever opens it
  while signed in follows her at once. Like the reading page link: 128 random bits, renewable,
  off when she turns followers off.
- **A request** (from her reading page, or by her exact address, both phase 2): she accepts or
  declines; a declined request looks to the asker exactly like one still waiting.

Right after following her, the app offers **"Let Anna follow you back"**: one tap that creates the
reverse follow, consented by the person tapping it. In a circle of five that makes most pairs mutual
without making mutuality a rule.

### How members find each other

There is no member-to-member invite graph to reuse (§1), and a directory of all members would tell
every member who else uses the app. So, by recommendation:

1. **Follow link** (MVP). Profile → Friends → *Your follow link* → the share sheet (`utils/shareLink.ts`
   already hands a link to the Web Share sheet or the clipboard). Opened signed in: a small pushed
   page with her name and photo and **Follow**; signed out: Sign in first, then back to it (the
   `middleware/auth.global.ts` keep-through-sign-in that the share target uses).
2. **The reading page** (phase 2). A signed-in member visiting `/r/<token>` sees **Ask to follow**
   in the footer, where a visitor sees the waitlist. A request, not a follow: reading page links are
   forwarded further than follow links.
3. **Exact address** (phase 2, optional). *Ask by email*: the asker types an address; the answer is
   always "Asked" whether or not it is a member, so the field cannot be used to learn who is in.
4. **The waitlist** (later, owner-only). When the owner invites someone who came from Ada's page
   (`private.waitlist.source_member_id`), the invite mail could carry Ada's follow request. Small,
   but it closes the loop #171 opened.

No directory, no search by name: names are free text in `user_metadata`, not unique, and editable at
will (`updateUser`), which makes them a poor key and an easy way to impersonate.

### Removing, blocking, limits

- **Unfollow** (the follower) and **Remove follower** (the followed): delete the row. Neither side
  is told; the removed member's feed simply stops showing her.
- **Block**: remove both directions and store `blocks(blocker, blocked)`. A blocked member's link
  visit, request and reading-page request are refused silently ("not found"), and neither appears in
  the other's feed, profile list or overlaps. In an invite-only circle this is the tool for an ex,
  not for spam; it must exist from the first slice anyway, because "remove" alone can be undone by
  the removed member opening the old link (renewing the link is the other half; the Remove confirm
  offers both).
- **Limits** (in the RPCs, like `join_waitlist`'s): at most 150 follows a member, 20 open outgoing
  requests, 30 follow or request calls an hour (`rate_limited`). The circle will never get near them;
  they stop a script, not a person.
- **Account deletion**: `follows`, `blocks`, `social_settings` and `activity` reference
  `auth.users on delete cascade`, so `delete_my_account()` needs no change: everything social of
  hers goes with her, and her followers' feeds lose her at the next load. Their devices may hold her
  last events in the cached feed page until then (§5, "Offline"); that cache is dropped after 7 days
  and on sign-out.

### Data (sketch)

```sql
create table public.social_settings (
  member_id      uuid primary key references auth.users on delete cascade,
  followers_on   boolean not null default false,  -- off: no link, no requests, nobody follows
  follow_token   text unique check (follow_token ~ '^[A-Za-z0-9_-]{22}$'),  -- null = no link
  show_reading   boolean not null default true,   -- Currently reading, "started"
  show_want      boolean not null default true,   -- Want to read, "added"
  show_finished  boolean not null default true,   -- Finished, "finished"
  show_ratings   boolean not null default true,
  show_reviews   boolean not null default false,  -- see question 4
  show_abandoned boolean not null default false,  -- DNF
  show_year      boolean not null default true,   -- figures and years in review
  updated_at     timestamptz not null default now()
);

create table public.follows (
  follower_id  uuid not null references auth.users on delete cascade,
  followee_id  uuid not null references auth.users on delete cascade,
  requested_at timestamptz not null default now(),
  accepted_at  timestamptz,                        -- null = a request still waiting
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee on public.follows (followee_id) where accepted_at is not null;

create table public.blocks (
  blocker_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- RLS: each member reads the follow rows she is part of, nothing else; her own settings and blocks.
create policy follows_mine on public.follows for select to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
create policy social_settings_own on public.social_settings for select to authenticated
  using (member_id = (select auth.uid()));
create policy blocks_own on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
```

Writes only through RPCs (`set_followers(on)`, `renew_follow_link()`, `set_social_sections(json)`,
`follow_by_link(token)`, `follow_back(member)`, `unfollow(member)`, `remove_follower(member)`,
`block(member)`, `unblock(member)`; phase 2 `request_follow_by_page(token)`,
`request_follow_by_email(address)`, `answer_request(member, accept)`), with stable refusals
(`not_signed_in`, `followers_off`, `follow_limit`, `rate_limited`) as the existing migrations raise
them. The token helper is `private.reading_page_token()`'s twin.

---

## 4. Another member's profile

### What is shown

A pushed page `/friends/<member id>` (the id is not a secret; the RPC answers `null` unless the
viewer may see her). Top to bottom, each block present only if her switch allows it:

| Block | Switch | Reused from |
|---|---|---|
| Hero: photo or initials, name, "Reading here since …", the Library line (read · reading · want) | always (the Library line's counts leave out private Books) | `components/profile/Hero.vue` (today it reads `session.member` and the avatar store directly: needs `member` props and a read-only ring) |
| Currently reading: a row of covers, "since 3 Oct", no progress | `show_reading` | `components/reading/CoverRow.vue` (the reading page's row) |
| Want to read: the newest 12 covers | `show_want` | `components/home/UpNext.vue`'s row |
| Year pills, four figures, By year / By month, Ratings, Records, Authors you return to | `show_year` (+ `show_ratings` for Average and Ratings) | `components/profile/{YearPills,Figures,Columns,Ratings,Records,Authors}.vue` unchanged: they take props |
| Recently finished, with her stars and her review where allowed | `show_finished`, `show_ratings`, `show_reviews` | `components/reading/FinishedList.vue`, `components/profile/ReadRow.vue` |
| Years in review cards | `show_year` | `components/profile/YearCards.vue` |
| **In common** (phase 2): the Books you both finished, both your stars side by side | `show_finished` | new, small |
| Her menu (⋯): Unfollow · Remove as follower · Block | — | `UiSheet` + `UiConfirm` |

Never shown, whatever the switches: her address, progress and reading days
(`reading_progress_days` stays hers: it is a diary of when she reads), abandon reasons, highlights,
notes, Collections (until §8's shared Collections), Book links, private Books.

### Reuse: a read-only Profile, not a new design

Two ways:

- **(a) One page with a `member` mode.** `profile/index.vue` gains a member parameter; the account
  rows, the photo sheet and Reading days hide for others. Risky: that page is long, carefully tuned
  (loading shape, sheet restore, the owner's shelf) and every change would have to keep both modes.
- **(b) A new page composed from the same components.** `pages/friends/[member]/index.vue` and
  `pages/friends/[member]/[year].vue` place the existing `components/profile/*` blocks fed by a
  per-member store. **Recommended**: the blocks are already prop-driven (`Figures.vue`,
  `Columns.vue`, …), only the page shells differ, and the own Profile stays untouched.

The data: one RPC `member_profile(member)` (hero, the rows, the switches, as jsonb, the way
`public_reading_page` builds its answer) and one `member_reading_record(member)` that answers the
closed reads **in the exact row shape of `SESSION_COLUMNS`** (id, entry_id, started_on, ended_on,
outcome, rating, created_at, entry → page_count_override, book), filtered by her switches and private
Books, so `readsFromRows` and `figuresOf` in `data/stats.ts` run unchanged. A `createMemberStats`
next to `createStats` is all the data layer needs; the native port gets the same reuse.

### How it relates to the reading page

Same idea (sections she switches), different audience. Recommendation: **keep them separate.** The
reading page is for the world and stays minimal; followers are people she let in and may see more
(Want to read, DNF if she likes). One sheet holds both: Profile → *Friends and sharing*, with a
**Followers** group above the existing **Reading page** group (`components/sharing/Sheet.vue`), so
she sees both audiences in one place. A follower who opens her `/r/<token>` link sees the public page
as anyone does; the profile in the app is the richer view. Token-less reading pages for followers
would merge the two audiences and make the public switches mean two things; not recommended.

Manual books: `public_reading_page` already shows them (its `reading_page_reads` joins `books`
without an owner filter), so a member's own edition is not secret from a visitor she gave the link.
The same goes for followers, built by the same kind of definer function. Followers cannot open a
Manual book's `/book/<id>` (`books_readable` refuses it); its cover opens nothing, or a read-only
card (phase 2).

---

## 5. The feed

### Event types

| Event | From | Default | Batches as |
|---|---|---|---|
| **Started** (incl. *Read again*: "started again") | a new open session | on (`show_reading`) | — |
| **Finished**, with stars (if `show_ratings`) and the review's first lines (if `show_reviews`) | a session closed `finished` | on (`show_finished`) | "finished 3 books" when ≥ 3 the same day |
| **Added to Want to read** | an entry whose first state, at commit, is Want to read | on (`show_want`) | "added 4 to Want to read", a fan of covers, per member per day |
| **Reviewed** (a review written later) | `review` set on a finished session that had none, after its finish event settled | on only with `show_reviews` | — |
| **Did not finish** | a session closed `abandoned` | **off** (`show_abandoned`) | — |
| Rating changed | — | **no event**: an edit is not news; the finish row shows the current stars anyway | — |
| Progress, milestones ("finished her 20th book of 2026"), "follows Ben" | — | **no event**: progress stays private (it already is on the reading page), milestones are goals in disguise (#166: "Not planned: reading goals"; the Profile: "no streaks, no goals") and the graph is nobody's business | — |
| Collection created / shared | — | not until shared Collections exist (§8) | — |

**What never makes an event** (the "nothing by accident" rule):

- **Imports.** `import_books` is granted to `authenticated` (the in-app Goodreads/Hardcover import),
  and `import_book_for` and the owner's Fable script write as the service role. A Goodreads import
  would otherwise post 600 "finished" rows. The import functions set a transaction-local flag
  (`set_config('libellus.quiet', 'on', true)`), and the triggers skip when it is on or when
  `auth.uid()` is null.
- **Logging old reads.** *Add with any status* (#9) logs a past read as Finished with its old dates.
  A finish or DNF whose `ended_on` is more than 14 days before today makes no event.
- **Private Books** (the per-Book switch) and a section she switched off: the events are written but
  never read out, so turning the switch on again later restores them, and turning it off hides the
  past too.

**Settle window.** An event is visible from `visible_at = created_at + 10 minutes`. A newer event on
the same entry inside the window replaces the older one (Want to read → Started is one "started"; a
Start corrected to a DNF is one DNF; Finish then Delete read is nothing, since the event cascades with
the session).

**Ordering and paging.** Newest `visible_at` first, `id` as the tie-break; keyset pages of 30
(`before = (visible_at, id)`), so new rows at the top never shift the page being loaded. The date
shown is her day (`ended_on`, `started_on`) in mono, the order is when it reached the circle: a book
finished offline on Saturday and synced Monday appears Monday, dated Saturday.

**Batching.** Done in the read function, not stored: consecutive events of the same member, same
kind and same day fold into one row (`Anna · added 4 to Want to read`, four covers in a fan). The
batch opens a `UiSheet` with the four rows.

**Empty states** (`UiEmptyState`, the lamp over the shelf):
- Following nobody: "Reading is better with a friend or two." · *Share your follow link*.
- Following people, nothing yet: "Quiet for now. When the people you follow start or finish a book,
  it shows here."

### Data design: three options

**A. An events table written by triggers.** `activity(member, entry, session, kind, on_day,
created_at, visible_at)`. Triggers on `reading_sessions` (insert; update of `outcome`; update of
`review`) and a deferred constraint trigger on `library_entries` insert (deferred to commit, so it sees
whether `add_to_library` went on to make a session: `add_first_session` in
`20261003112000_add_with_any_status.sql` runs after the entry's insert). Every path is covered: the
online RPCs, `sync_write` (which calls the same functions), `update_session`.

**B. A view (or RPC) over the library tables, no new table.** Started = open sessions'
`started_on`, finished = `ended_on`, want = entries' `added_at`.
It cannot work well here: `reading_sessions` has **no `updated_at`**, so a finish has only the day she
picked, not when it happened (ordering by day mixes a book logged today for last week with today's);
a Want to read entry stops being "added" the moment she starts it (state, not history); imports and
old reads cannot be told apart from news; and every feed load scans every followed member's whole
history.

**C. An events table written explicitly by the RPCs** (`finish_reading` calls
`private.record_activity(...)`). Explicit and import-proof by construction, but a dozen functions
(`start_reading`, `read_again`, `finish_reading`, `abandon_reading`, `update_session`, `add_to_library`,
`add_first_session`, `add_to_collection`'s add, `change_edition`'s moves, …) must each remember to call
it, and every future one too.

**Recommendation: A**, with the quiet flag in the two import functions. Triggers are how this schema
already keeps derived state honest (the Status is recomputed by triggers from the sessions;
`reading_page_books_entry_gone` / `_entry_moved` follow entries the same way).

```sql
create table public.activity (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references auth.users on delete cascade,
  entry_id   uuid not null references public.library_entries on delete cascade,
  session_id uuid references public.reading_sessions on delete cascade,
  kind       text not null check (kind in ('want', 'started', 'finished', 'reviewed', 'abandoned')),
  on_day     date,                                         -- her day: started_on / ended_on / added
  created_at timestamptz not null default now(),
  visible_at timestamptz not null default now() + interval '10 minutes'
);
create index activity_feed on public.activity (member_id, visible_at desc, id desc);
create unique index activity_once on public.activity (session_id, kind) where session_id is not null;

alter table public.activity enable row level security;
revoke all on public.activity from anon, authenticated;   -- read only through feed()
```

**Denormalised: as little as possible.** The row stores *what happened and to which entry*; the
Book (current, so Change edition follows), the stars and the review are read live from the entry and
the session. An edited rating shows the new one; a deleted review is gone everywhere at once; nothing
stale has to be cleaned up. The Book JSON comes from a function like `private.reading_page_book_json`.

**RLS.** The table gets no grant (as `synced_writes` and `private.waitlist`): the only reader is
`feed(before, before_id, limit)`, security definer, which applies follows, blocks, her switches and
the private flag in one place. If a direct select is ever wanted (for Realtime, below), the policy
would be:

```sql
create policy activity_followers on public.activity for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (
      select 1 from public.follows f
       where f.follower_id = (select auth.uid())
         and f.followee_id = activity.member_id
         and f.accepted_at is not null)
  );
```

and it shows why the RPC is better: the policy runs as the reader, who cannot read the other
member's `social_settings` or the entry's private flag (both are `*_own`), so the switches and
private Books could not be applied without opening those tables too. The definer function, in
outline:

```sql
create function public.feed(p_before timestamptz default null, p_before_id uuid default null,
                            p_limit integer default 30)
returns jsonb language sql stable security definer set search_path = pg_catalog, public, private as $$
  with me as (select auth.uid() as id),
  followed as (
    select f.followee_id as id from public.follows f, me
     where f.follower_id = me.id and f.accepted_at is not null
       and not exists (select 1 from public.blocks b
                        where (b.blocker_id = f.followee_id and b.blocked_id = me.id)
                           or (b.blocker_id = me.id and b.blocked_id = f.followee_id))
  )
  select coalesce(jsonb_agg(private.activity_json(a) order by a.visible_at desc, a.id desc), '[]')
    from (select a.* from public.activity a
            join followed on followed.id = a.member_id
            join public.social_settings s on s.member_id = a.member_id and s.followers_on
            join public.library_entries e on e.id = a.entry_id and not e.private
           where a.visible_at <= now()
             and private.activity_shown(a.kind, s)            -- the section switches
             and (p_before is null or (a.visible_at, a.id) < (p_before, p_before_id))
           order by a.visible_at desc, a.id desc
           limit least(greatest(p_limit, 1), 50)) a
$$;
```

(Batching folds the rows in `data/feed.ts` afterwards, framework-free, so a native client folds them
the same way.)

**The per-Book switch** is a column, `library_entries.private boolean not null default false`, set by
`set_entry_private(entry, on)`. A column on the entry follows it through Change edition and dies
with it, like `read_as`.

**Retention.** The feed is for now; the profile is the history. A `purge_activity()` drops events
older than 13 months, run by pg_cron like `purge-synced-writes` (`20261005094846_synced_writes_cleanup.sql`).

**Realtime or pull?** Pull: load when the feed or Home shows (`onActivated`, as Home already reloads
its lists), pull to refresh, nothing in between. Realtime's Postgres Changes would need the table
readable through RLS (above), costs a socket per open app, and pushes the opposite of calm. The
quota would not be the problem (Free plan: 200 concurrent connections, 2 million messages a month;
[Supabase quotas](https://supabase.com/docs/guides/realtime/quotas)).

**Cost.** Twenty members logging ~150 events a year each is 3,000 rows a year, a few hundred kB with
indexes; the feed query is an index range scan per followed member. Nothing on the Free plan moves.

### Offline

- **Reads are online.** The device keeps the newest feed page and each profile last opened, like
  `saveStats` keeps the Profile's record (under the `libellus.` prefix, so sign-out clears them),
  shown with "Offline · as of 14:02". A cached page older than 7 days is dropped rather than shown,
  so a removed follower's device does not keep showing her for long.
- **The outbox must NOT queue** (they stay online-only, disabled and labelled "Offline" per
  web/AGENTS.md): follow by link, follow back, unfollow, remove follower, block and unblock, requests
  and answers, turning followers on or off, renewing the follow link, the section switches, and
  everything in §8 that reaches another member (send a book, "want to read too"). They involve rows
  of another member or change who may see what; a delayed or replayed one would surprise someone.
- **May queue: `set_entry_private`.** It names an entry she already has (the outbox's rule in
  `docs/parity.md`, "Save offline and sync later"), and the outbox sends in order: *Hide from
  followers* then *Finish*, both offline, reach the server in that order, and the settle window
  covers a finish followed by a hide within 10 minutes. It goes into `sync_write`'s action list next
  to `save_reader_highlight`.
- Writes that are queued today (`finish_reading`, `start_reading`, …) make their events when they
  sync, through the same triggers; `on_day` keeps her day.

---

## 6. Other members' years in review

- **Reuse.** `/friends/<member>/<year>` composes the blocks of `profile/[year].vue` (months as rows
  of covers, the favourite, ratings, records, authors, the years either side) fed by
  `member_reading_record(member)` (§4). `figuresOf(reads, year)` gives the same figures; only the
  page shell is new. Her Reading days are not shown. The owner's Regal row on *his* year stays his
  (`stores/shelf.ts` decides by `NUXT_PUBLIC_SHELF_OWNER_ID`); a follower looking at the owner's year
  could see it, since the library file is published anyway (fabkho.dev/books).
- **In common, not against each other.** One block on her year page, when there is any: **"You both
  read"**, the Books you both finished that year, each with both your stars (`★ 4.5 · ★ 3.75`). The
  match is by *work*, not edition: two members rarely own the same edition, and `book_works` (#167,
  `20261011011000_authors_works_series.sql`) maps Catalogue Books to works; Books without a work fall
  back to the same `book_id`. No "you read more than Anna", no side-by-side totals: comparison of
  amounts is a leaderboard of two.
- A **circle year** (all followed members together) is §8's *Our year*.

---

## 7. Where it lives in the app

### Options

| | Pros | Cons |
|---|---|---|
| **A. A third tab "Friends"** (Home · Library · Friends + Search) | Always one tap away; the feed gets a home of its own | The capsule (`components/shell/TabBar.vue`, `PAGES`) and the search morph (the palette shows the page tabs at its left with the keyboard down, `docs/MOTION.md` "Search morph") were built around two pages; a tab says "this is a main thing", which a calm circle of five is not, at first |
| **B. A section on Home** ("Your circle", the last 3–5 rows, *See all* → a pushed `/friends`) | Home is "what matters now" (parity.md, Home); friends reading now fits; no chrome changes; follows the *Next in your series* pattern (last on Home, so its arrival moves nothing under it) | Below the fold for a member with many books in progress |
| **C. Under Profile only** | No new surface at all | The feed hidden two taps deep; nobody would look |

**Recommendation: B for the feed, C for the management.** Home gets *Your circle* at the end (only
for a member who follows someone; otherwise nothing, not even an empty state, so nobody is nudged to
be social). Profile gets a **Friends** section before *Share*: Following, Followers, your follow link,
what followers see. If the circle turns out to be used daily, promoting `/friends` to a tab later is
a small change (question 7).

### Routes

| Route | Screen |
|---|---|
| `/friends` | the feed, pushed (`definePageMeta({ layout: 'tabs', pushed: true })`) |
| `/friends/people` | Following · Followers (· Requests, phase 2) |
| `/friends/<member>` · `/friends/<member>/<year>` | her profile · her year in review |
| `/f/<token>` | a follow link opened (signed in: Follow; signed out: Sign in, then back) |

`useErrorLog`'s route is the raw path, so it would write another member's id into the owner's error
log. The member pages report their route pattern (`/friends/[member]`), as `plugins/vitals.client.ts`
already does with `routePattern`.

### Wireframes

Low-fi, in the design's terms: eyebrows in mono caps, titles in the serif, hairlines between rows,
covers as `[▮]`, the lamp `●` for the one lit thing. These sketch the proposal; the mocks of what
version 1 ships, in both themes, are in [`social/`](social/) (`mock.html`, `v1-*.png`) and described in
[social-v1.md](social-v1.md).

**1. Home, last section: Your circle**

```
 ─────────────────────────────────────────
  NEXT IN YOUR SERIES                    …
 ─────────────────────────────────────────
  YOUR CIRCLE                     See all ›
  (A) Anna  finished                 3 OCT
      [▮] The Left Hand of Darkness
          Ursula K. Le Guin   ★★★★½ 4.5
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  (B) Ben   started                  2 OCT
      [▮] Piranesi · Susanna Clarke
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  (A) Anna  added 3 to Want to read  1 OCT
      [▮][▮][▮]
                ( ⌂  ▤  ⌕ )
```

**2. The feed `/friends`** (pushed; pull to refresh; the same rows, paged)

```
 (‹)                                  (⚇)      ⚇ = Following & followers
  Your circle
  TODAY
  (A) Anna  finished                       ★★★★½
      [▮▮] The Left Hand of Darkness
      [▮▮] Ursula K. Le Guin
           "Cold, slow and the warmest book I read
            this year…"                  More ›     (only with show_reviews)
           [ Want to read too ]                     (phase 2, quiet button)
  ─────────────────────────────────────────
  YESTERDAY
  (B) Ben   started again
      [▮] Piranesi · Susanna Clarke
  ─────────────────────────────────────────
  (C) Clara finished 3 books               [▮][▮][▮] ›   (a batch opens a sheet)
  ─────────────────────────────────────────
          Offline · as of 14:02                     (only offline)
```

**3. A member's profile `/friends/<id>`** (lit by her favourite cover, as the Profile is)

```
 (‹)                                    (⋯)       ⋯ = Unfollow · Remove · Block
                ( A )
                Anna
       Reading here since March 2025
         42 read · 2 reading · 17 want
  CURRENTLY READING
  [▮] [▮]
  WANT TO READ                             17 ›
  [▮][▮][▮][▮][▮][▮] →
  ( All )( 2026 )( 2025 )
 ─────────────────────────────────────────
  BOOKS 23     PAGES 7.4K   AVERAGE ★3.9   DAYS A BOOK 11
 ─────────────────────────────────────────
  BY MONTH   ▁ ▃ ▅ ▂ ▇ ▃ ▁ ▄ ▆ ▂ · ·      2026 in review ›
  YOU BOTH READ (2026)                      (phase 2)
  [▮] Piranesi           you ★4.5 · Anna ★4
  RECENTLY FINISHED
  [▮] The Left Hand of Darkness   ★4.5 · 3 Oct
  YEARS IN REVIEW   [2026] [2025]
```

**4. Following and followers `/friends/people`**

```
 (‹)
  People
  ( Following )( Followers )                (UiSegmented)
  (A) Anna                                   ›
  (B) Ben                                    ›
  (C) Clara                     Follow back
  ─────────────────────────────────────────
  YOUR FOLLOW LINK
  libellus.fabkho.dev/f/Xq3…        [Share]
  Anyone in Libellus you send it to can follow you.
  New link                                   ›
```

**5. Profile → Friends and sharing (the sheet)**

```
  Cancel        Friends and sharing
  FOLLOWERS
  Let people follow me                    [●━]
  WHAT FOLLOWERS SEE
  Currently reading                       [●━]
  Want to read                            [●━]
  Finished                                [●━]
  Ratings                                 [●━]
  Reviews                                 [━○]
  Did not finish                          [━○]
  Year in review and figures              [●━]
  Books you hide from followers stay hidden
  everywhere. Hide one from its ⋯ menu.
  READING PAGE
  Reading page                      On   ›       (the existing #171 sheet)
```

**6. Book → ⋯ (the existing options sheet), one new row**

```
  Share                                      ›
  Hide from followers                     [━○]
  Change edition                             ›
  …
```

### Components reused

`UiSheet` (every sheet above), `UiConfirm` (Remove, Block, New link), `UiListMotion` (feed rows that
come and go after a refresh), `UiRowGroup`/`UiRow`/`UiSwitchRow` (settings), `UiSegmented`
(Following/Followers), `UiAvatar` (with the followed member's photo, once the avatars policy allows
it), `UiCover` + the cover flight (`composables/useBookFlight.ts`: a feed cover flies into its book
page, as Home's do), `UiStars`, `UiEmptyState`, `UiPressLink` (rows start on touch-down), the
`components/profile/*` blocks, `components/reading/{CoverRow,FinishedList}.vue`, `UiAmbient` (a
member's profile lit by her favourite). New: `FriendsRow` (one feed row), `FriendsBatch`, a
`MemberHero` variant. Motion: nothing new; *Push to the Profile* already grows an avatar into a hero
(MOTION.md), which a member's avatar in the feed can reuse.

---

## 8. Ideas beyond the basics

Value / effort / risk: H, M, L. "Fits" is why it belongs in *this* app.

| # | Idea | V | E | R | Fits because |
|---|---|---|---|---|---|
| 1 | **Want to read too.** One quiet button on a feed row and on a member's profile: adds the Book to *your* Want to read (the existing `add_to_library`) and tells her, once, in her circle section: "Ida wants to read this too". No count, no list of who. | H | S | L | Replaces likes with the one reaction a reading app needs: it ends in a Book on a shelf, not a number. |
| 2 | **Your circle on a Book's page.** Under the Goodreads line: "Anna ★4.5 · Ben is reading it" (by work, via `book_works`). | H | S | L | The Book page is where she decides to read; a friend's stars beat a stranger's average. |
| 3 | **Send a book.** Book → ⋯ → *Send to…* a follower, with a note (≤ 280 characters). It lands in a small *For you* row on Home, never in the feed; one tap puts it on Want to read. | H | M | L | A recommendation between two people, the way it happens in life; no feed noise. |
| 4 | **Spoiler-safe reviews.** A switch on the Finish sheet: "Contains spoilers". Followers who have not finished the Book see the review folded behind *Show anyway*. | M | S | L | Reviews to followers only work if they do not ruin the Book for the next friend. |
| 5 | **Reading together (buddy read).** Two members link their open reads of the same work. Each sees the other's progress bar on the Book page and the Home card, and can pin a note to a page that stays hidden until the other has passed it (StoryGraph's [buddy reads](https://roadmap.thestorygraph.com/changelog/buddy-reads-) do the same). Progress leaves the database only here, only with both opting in. | H | L | M | Couples and friends do read the same book at the same time; this is the warmest feature a circle of five can have. |
| 6 | **Currently reading together (light).** Without any linking: the Home card shows the small avatars of followed members who have the same work open right now. | M | S | L | A free by-product of #2; a nice surprise, no setup. |
| 7 | **Friends' Want to read on yours.** On your Want to read row and in the Library: a tiny avatar on Books a followed member also wants to read, and a *Read it together?* link that starts #5. | M | S | L | Turns two shelves into a plan, without a single new screen. |
| 8 | **Shared Collections.** A Collection with members who can all add to it ("Holiday 2027", "Books for the cottage"). | M | L | M | Collections already exist and are per member; sharing one is natural, but `collection_entries` point at a member's entries, so it needs a Book-level model: phase 3. |
| 9 | **Our year.** In December, a page for the circle: the months with everyone's finished covers, the Books more than one of us read, each member's favourite. No totals per person, no winner. | M | M | L | The year in review is the app's most loved screen; a shared one is a gift, once a year (#166 kept "Wrapped" as low priority). |
| 10 | **Follow from the reading page.** Signed-in visitors of `/r/<token>` see *Ask to follow* (§3). | M | S | L | Links the two audiences without merging them. |
| 11 | **Ask my circle.** "Something light for a train ride?" goes to followers, who answer by sending a Book (#3). Expires after a week. | M | M | M | Recommendations from people who know you; risk: it drifts towards a forum, so no threads and no replies to replies. |
| 12 | **Weekly letter (opt-in).** Sunday, a short mail in the app's mail design: the covers your circle finished this week. Through the same SMTP the `waitlist-invite` function uses, a pg_cron job and an edge function; one-click unsubscribe. | M | M | M | Calm by construction: once a week instead of a notification each time; risk: book titles of friends now go through the mail provider (§9). |
| 13 | **Notifications for things addressed to you only** (a Book sent to you, a follow request), never for the feed. iOS shows web push only for the home-screen app (16.4+); the Android TWA (#102, not merged) has notification delegation off. | L | L | M | Later, if ever; the circle works without it. |
| 14 | **A quiet "read in the circle" line on her Profile's year**: "3 of your books this year came from Anna" (where #3 or #1 started them). | L | S | L | Gratitude, not score; only from data already there. |

**Dropped, and why**

- **Likes, comments, threads.** Counts and conversation are what the circle is meant to avoid;
  #1, #3 and #11 cover the useful part.
- **Streaks, challenges, leaderboards, "reading goals".** The Profile says "no streaks, no goals",
  #166 says "Not planned: reading goals"; between friends they turn reading into a competition.
- **Book club rooms with chat** (Fable's chapter rooms). Moderation, notifications and a chat
  product; #5's page-pinned notes are the small, spoiler-safe part of it.
- **A member directory, "people you may know", follower counts.** §2.
- **Progress in the feed** ("Anna is on p. 212"). Progress stays private except inside a buddy read.
- **A map of where the circle reads** (the bookretreats site has a community map, PR #1 there).
  Location is the wrong data to collect in a private reading app.

### Later: small games (not in the first social release)

The owner would like playful, small things later, the kind that are quick to build with AI's help.
They should follow the same rules: played alone or by two people, nothing saved as a score, no
leaderboards, no "play every day" nudges, built only from data the player is already allowed to see.

| Game | How it plays | Data |
|---|---|---|
| **Pick me** (this or that) | Two covers from your Want to read, tap the one you want more; a few rounds later one Book is left: "Read this next?" → Start reading. | your own Want to read |
| **Cover memory** | A matching game: 6–8 pairs of covers from the circle's year, flipped two at a time; a matched pair shows who read it. | covers the player may see through `feed()` / profiles |
| **Who read it?** | A cover from the circle's year; guess which friend finished it. Three choices, no score kept. | the same |
| **Blind date with a book** | A Book sent with #3 arrives wrapped: genre, page count and three words the sender chose; unwrap to see it. The bookshop classic. | #3's note, Catalogue facts |
| **Guess the book** | A riddle from a Book's Catalogue description and year (title and names masked), generated once per Book by an LLM in the enrich function. | Catalogue only, never a member's data |
| **Connections** | 16 covers from your own shelves; find the four groups (same author, same series, same year, same genre). | your Library, `book_works`, genres |

AI makes the content cheap (clues, riddles, groupings), but an LLM provider becomes a new
sub-processor the moment it receives anything: keep it to Catalogue data, generated server-side and
cached like `goodreads_ratings`, never a member's reads or reviews.

The game ideas the owner mentioned from his other project, bookretreats (a site for women's reading
weekends), are not written down there: `fabkho/bookretreats` has no issues, and its only open pull
request is the community map (#1). The table above is therefore a first list to react to; *Pick me*
is a guess at the name he used.

---

## 9. Privacy, legal and operations

### Promises in the docs that change (when slice 1 lands, not before)

- **README.md**: the intro "No social feed, no ads, no trackers." → "A quiet feed of the friends
  you follow; no ads, no trackers." · *What it does*: a bullet on following. · **Privacy**: "a member
  only ever reads her own Library, reviews, Collections and Book links" → "…her own, and of other
  members only what they show their followers: off until she turns it on, per section, per Book".
  #212 / PR #220 is rewriting this section now; this proposal does not edit it. What the rewrite must
  then gain: a **Followers** bullet (off by default, consent by link or request, what is shown and
  never shown, private Books, remove and block, retention of the activity: 13 months), and, if #12 is
  built, that the mail provider sends the weekly letter with friends' Book titles in it.
- **SPEC.md**: §1 Non-goals (drop "friends, feed, follows"; keep "likes"), §8 "Invite-gated…
  No social." and "Sharing is a link, not a network … no accounts, likes or follows" (rewrite: the
  link stays; following is a second audience), §4 the new tables, §5 the new routes, §6 Privacy.
- **CONTEXT.md**: new terms **Follower**, **Following**, **Follow link**, **Follow request**,
  **Circle** (the members she follows), **Activity** (one event of the feed), **Hidden from
  followers** (a private Library entry). The Profile's definition ("Figures and covers only") gains
  "and another member's, as her followers see it".
- **docs/parity.md**: new entries (Friends section, Following and followers, Follow link, Feed, Home's
  Your circle, Member profile, Member's year in review, Hide from followers), and edits to *Profile
  photo* ("Shown to her alone"), *Delete account*, *Reading page* ("without a social network").
- **App copy** (`web/i18n/locales/en.json`): `photo.private` "Only you see it." → "You and your
  followers see it."; `profile.deleteAccount.text` adds "who you follow and who follows you"; the
  Sharing sheet's `sharing.about` mentions followers.
- **`20261009120000_avatars.sql`'s comment** and a new select policy for followers:
  `bucket_id = 'avatars' and exists (select 1 from public.follows f where f.follower_id =
  (select auth.uid()) and f.followee_id::text = (storage.foldername(name))[1] and f.accepted_at is
  not null)` (spelled out in the policy, as that migration does, since `private` is closed).
- **#166's text** (the "no feeds, follows or likes" line): a comment linking this proposal.

### GDPR

- **Lawful basis**: her consent, given by turning followers on and handing out the link, and
  withdrawn by turning them off (everything disappears for followers at the next read, §2.5).
- **Erasure**: everything social cascades from `auth.users` (§3). Followers' devices hold at most the
  last feed page, ≤ 7 days, cleared on sign-out. Nightly backups keep 35 days, as for every other row
  (docs/OPERATIONS.md, Backups).
- **Export (#170)**: add her settings, who she follows and who follows her (names), her hidden
  Books and the Books sent to her with the sender's first name and note. Not other members' reading:
  it is theirs, not hers to export.
- **The owner** gains no view into anyone's circle. No owner function reads `follows` or `activity`.

### Moderation and abuse in an invite-only circle

The realistic harms are personal, not spam: an ex, a pushy follower, a review someone did not want
seen. The tools: consent before anyone sees anything, Remove and Block (silent), a new follow link,
per-Book hiding, the settle window. The owner's lever stays the invite: he decides who joins and can
delete an account from the Supabase dashboard if he must (there is no in-app owner deletion, and this
proposal adds none). Names are free text: the member profile shows the photo with the name, and the
follow link page shows both before Follow, so a renamed impostor is visible.

### Operations

- **Error log**: member routes reported as patterns (§7). Feed errors carry no names or titles
  (`docs/OPERATIONS.md`, Client errors: "technical details only, no content").
- **Cost**: no Realtime, no new service; a few thousand rows a year; one pg_cron job. Push (#13) and
  the weekly letter (#12) are the only ideas that add moving parts.
- **Advisors**: the new definer functions follow the existing checklist (pinned `search_path`,
  revoke from `public`/`anon`), so `docs/OPERATIONS.md`, "Supabase advisors", gains nothing to accept.

---

## 10. Recommendation and roadmap

Order: value first, privacy risk down front (the rules are built and tested before any screen
shows another member). Tiers as the coordinator maps them: **heavy** = Opus 5.5 (RLS, the feed's
design, design-heavy screens), **advanced** = Sonnet 5.5, **simple** = DeepSeek flash.

### MVP

**Slice 1: the rules (database only).** `social_settings`, `follows`, `blocks`,
`library_entries.private`, `activity` with its triggers, the quiet flag in `import_books` /
`import_book_for`, the 14-day rule, the settle window, `feed()`, `member_profile()`,
`member_reading_record()`, the follow RPCs (link, back, unfollow, remove, block), `set_entry_private`
(also in `sync_write`), the avatars select policy, `purge_activity()` on pg_cron.
*Tests*: pgTAP acting as three real members (follower, followed, stranger): nothing visible before
consent; link follow; remove and block; every switch; a private Book hidden in feed, profile, figures
and counts; imports and old reads silent; the settle window; deletion cascades; `anon` gets nothing.
*Tier*: **heavy**.

**Slice 2: following, in the app.** Profile → *Friends and sharing* (the Followers group above the
reading page's), `/f/<token>`, `/friends/people`, Book ⋯ → *Hide from followers*, `data/social.ts`
and `stores/social.ts`, the offline labels, the copy changes of §9, parity entries, e2e
(`friends.spec.ts`: two members, a link, follow back, remove, block; offline disabled) and the a11y
scans of the new sheets in both themes. *Tier*: **advanced** (screens are settings-like).

**Slice 3: the feed.** `/friends`, Home's *Your circle*, batching in `data/feed.ts` (Vitest), the
device's copy of the last page, pull to refresh, empty states. e2e: a finish by one member appears
for the other after the window (the window shortened in tests through a setting), a private Book
never does. *Tier*: **heavy** (the feed row and Home section are the design-heavy part).

**Slice 4: member profile and year in review.** `/friends/<member>`, `/friends/<member>/<year>`,
`createMemberStats` over `member_reading_record`, the Hero's member props, the switches applied.
e2e and a stats test proving the figures equal `figuresOf` on the same rows. *Tier*: **advanced**.

### Then

| Phase | Slices | Tier |
|---|---|---|
| 2 | *Want to read too* (#1) · Your circle on a Book (#2) · Spoiler-safe reviews (#4) · You both read (§6) · Follow requests from the reading page and by address (§3) | advanced; #2 and "You both read" heavy for the work matching |
| 3 | Send a book with *For you* on Home (#3) · Currently reading together (#6) · Friends' Want to read (#7) | advanced |
| 4 | Reading together / buddy reads (#5) · Our year (#9) | heavy |
| 5 | Shared Collections (#8) · Ask my circle (#11) · Weekly letter (#12) | heavy · advanced · advanced |
| Later | The small games (§8) · notifications for things sent to you (#13) | simple to advanced per game; heavy for push |

### Decisions for the owner

1. **Consent model**: one-way follow with consent (link = consent, requests otherwise), one-way
   without consent, or mutual friends? *Recommended: one-way with consent.*
2. **Finding people**: follow link only in the MVP, the reading page's *Ask to follow* and *Ask by
   email* in phase 2, no directory? *Recommended: yes.*
3. **Defaults of what followers see** once she turns followers on: reading, Want to read, finished,
   ratings, year on; reviews and DNF off? *Recommended: yes.*
4. **Reviews**: off by default with one switch, or per Book like the reading page? *Recommended: one
   switch, off by default, plus spoiler folding (phase 2); per Book stays the reading page's way.*
5. **Manual books and own editions**: shown to followers like any Book (as the reading page already
   does), or always hidden? *Recommended: shown, not tappable.*
6. **Settle window**: 10 minutes? *Recommended: yes; 0 in tests.*
7. **Where the feed lives**: Home section + pushed page now, a tab only if it is used daily?
   *Recommended: yes.*
8. **Photos**: may followers see her photo? *Recommended: yes, with the copy change.*
9. **Want to read in the feed**: on (batched) or off? *Recommended: on, batched per day.*
10. **The docs reversal**: rewrite SPEC.md's non-goals and decisions in the same PR as slice 1?
    *Recommended: yes, so the spec never says the opposite of the database.*
11. **Games**: keep them as a later phase, built only from data the player may already see, never
    scored? *Recommended: yes.*

### Not verified

- What `public_reading_page` shows of a Manual book was read from the SQL
  (`private.reading_page_reads` joins `books` without an owner filter), not tried in a browser.
- The mail provider of the owner's instance: the repository names only SMTP secrets
  (`supabase/functions/waitlist-invite`), not which service is behind them.
- Comparable apps' behaviour comes from their own help pages and roadmaps (linked above), not from
  using them.
