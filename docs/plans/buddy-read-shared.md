# Buddy reads again, starting from what Trappist already has (phase 1: findings, sharing options, questions)

**Status: phase 1 of a plan, for the owner's answers. No code, no build plan yet.** Read on 2 November 2026.
Libellus side: `origin/main` at `78e974e4` (1.31.0). Trappist side: `/Users/fabkho/code/trappist`, `07eab300`
(1.30.4, 31 October 2026; two newer commits on its `origin/main` are CI-only), read only. `@fabkho/ui` was read at
`origin/main` (`11dd8ab`, release 0.10.6; the local checkout is 57 commits behind, so every claim about it is from
`git show origin/main:…`). Regal at `2eb5953`. Paths without a repo name are Libellus; `trappist:` and `ui:` paths are
read only.

The earlier plan, [`docs/plans/buddy-read.md`](https://github.com/fabkho/libellus/blob/plan/buddy-read/docs/plans/buddy-read.md)
on branch `plan/buddy-read` (draft PR #333, 12 October, 706 lines), is a different history and is not built on. It is
quoted as "the old plan" with its section letters.

## Headline

1. **Trappist already built what the old plan wanted to build, and more.** Groups of up to 30 members, **buddy reads
   inside a group** with a comment thread per chapter, chapter markers ("read through chapter n") that veil the later
   threads, GIFs, photos, reactions, replies, reports, push and mute, live updates. Merged 22–29 October 2026 as work
   packages G0–G12 (`trappist:docs/plans/groups.md`, "Work packages"; 268 commits since the old plan's audit
   commit `0f3c2af`, 8 October). The old plan said "Trappist's chat is strictly 1:1". It is not any more.
2. **The presentational chat is already shared**: it moved into `@fabkho/ui` on 19 October (`trappist:ae5aea9e`, #298).
   Libellus is on 0.10.6, has the base's chat words wired for English and German (`web/app/utils/uiText.ts`,
   `web/app/plugins/ui-text.ts`) and uses none of the chat components yet. Everything the old plan §E called "copy
   `ChatMessage.vue`, `ChatComposer.vue`, `ChatGifPicker.vue`, …" no longer exists in Trappist.
3. **The client logic is half extracted, and Trappist wrote down how to finish it.** `trappist:web/layers/chat/` is a
   local Nuxt layer (1,136 lines: send queue, thread merge, spoiler veil, chapter division, an adapter contract),
   guarded by a test so that it imports nothing from the app, built "so it can leave the app by a subtree split like
   `@fabkho/ui` did" (`groups.md`, "Port to BetterReads"). The Realtime wrapper with the iOS fixes, the photo
   resizer and the GIF client are still in Trappist's app and still entangled with its domain.
4. **The database cannot be shared as code and Trappist already says so** ("The database stays per app", same
   section). What can be shared is the behaviour, written down as pgTAP and a checklist of the bugs it paid for.
5. **The product models differ**, and that is the real decision: Trappist veils chapters in the *client* from a
   *hand-set* marker and "tracks nothing"; the old plan gated in *SQL* per message from *automatic* reading
   progress. Libellus has the progress, the ebook reader and a smaller circle. Questions 7–9 below.
6. **Recommendation:** finish Trappist's own plan. Make `web/layers/chat` a small public, tag-pinned `fabkho/chat`
   package (the `@fabkho/ui` way, not Regal's branch way), let Libellus be its second consumer, write Libellus' SQL
   by hand against Trappist's snapshot, and keep Trappist's veil model for v1. Part 3.

---

## 1. What Trappist has, today

### 1.1 Timeline (commit dates, `git log` in Trappist)

| Date (2026) | What | Where |
|---|---|---|
| 8 Oct | KLIPY replaces GIPHY, **the `gifs` Edge Function is deleted**; sweep of orphaned chat media | #120 (`0ff98af2`), #116 |
| 8–14 Oct | reactions, double-tap ❤️, voice messages (≤ 2 min), replies ("answer one message"), Feed | #96, #130, #143, #235, #209 |
| 19 Oct | **the chat UI moves to `@fabkho/ui`**, `ChatMessage`, `ChatComposer`, `ChatGifPicker`, `ChatMediaViewer`, `ChatQuote`, `ChatVoiceBubble`, `timeline.ts`, `reply.ts` deleted from the app | #298 (`ae5aea9e`, −3,741 lines) |
| 20–22 Oct | plan for group chats and buddy reads; groups in the database and the app (G0–G5, G7, G8) | #314, #316–#325 |
| 23 Oct | **buddy reads in the database (G11) and the app (G12)**; group picture; Orga counts | #328, #330, #329, #334 |
| 28–29 Oct | custom chapters ("Prolog", "Zwischenspiel") anywhere; follow-ups (live invitation nudge, large text) | #337, #338, #344 (`c2805bff`, 29 Oct, carries `20270514120000_group_followups.sql`) |

(The migration *file names* run ahead of the commit dates, `20270502…` to `20270514…` are all 22–29 October; the
sequence is Trappist's own and does not interact with Libellus' `202611…` numbers.)

### 1.2 Database (source: `trappist:supabase/schema-snapshot/`, the generated current state; migrations for history)

**Shape.** One message table for 1:1 and groups:

| Table | What | Evidence |
|---|---|---|
| `conversations` | `kind` in `connection`, `host`, `group`; `member_a`/`member_b` for 1:1, null for groups (`conversations_group_shape`) | `schema-snapshot/tables/public.conversations.sql` |
| `messages` | `kind` text, phone_share, system, media, book; `client_id` (unique per sender); `created_at default clock_timestamp()`; media columns (`media_kind` image, gif, voice; `media_path` or `media_url`); `reply_to`; `chapter_id`, `spoiler`; `hidden_at` (the Orga); system-line people | `…/public.messages.sql` |
| `message_reactions` | one of six emoji per member and message, key `(message_id, account_id)` | `…/public.message_reactions.sql` |
| `chat_groups`, `chat_group_members` | group = title, photo, `history` (`all` / `since_join`), `entry_closed`; member = `role` admin/member, `joined_at`, `left_at`/`left_reason`, `last_read_at` (the unread cursor), `muted_until`; at most 30 | `…/public.chat_groups.sql`, `…/public.chat_group_members.sql` |
| `buddy_reads` | belongs to a group; a book *snapshot* (`book_title`, `book_author`, `book_cover`, `book_isbn`, no FK to a catalogue), `status` active/finished/archived, `chapters_from` count/pages; at most 3 active per group | `…/public.buddy_reads.sql` |
| `buddy_read_chapters` | `position` 1–101, `kind` chapter/end, `title`, optional `start_page`/`end_page`; unique `(buddy_read_id, position)` deferrable | `…/public.buddy_read_chapters.sql` |
| `buddy_read_marks` | one row per member and buddy read: `read_through` 0–100 (chapter number, **never a page**) | `…/public.buddy_read_marks.sql` |
| `buddy_read_cursors` | `(chapter_id, member_id, last_read_at)`: unread per chapter | `…/public.buddy_read_cursors.sql` |
| `chat_media_trash`, `chat_group_rate_log`, `reports` | storage sweep queue; group create/add limiter; reports with `message_id` and `item_kind` post/comment/message | `…/tables/` |

**Grants, as Libellus wants them.** `authenticated` can *select* `conversations`, `messages`, `message_reactions` and
`reports` (1:1 rows by the policy `conversation_party`, which is false for group rows because their `member_a`/`member_b`
are null), and *write* `message_reactions` directly. The group and buddy-read tables have **no** `authenticated` grant
at all (`schema-snapshot/grants/tables.sql`): every group read goes through set-based `security definer` RPCs
(`group_messages_readable`, `group_info`, `buddy_read`, `group_buddy_reads`). That is Libellus' own rule ("every read and write
through `security definer` RPCs", `AGENTS.md`), so the *group* half ports directly; the 1:1 half (policy reads, reactions
written into the table) does not.

**The behaviour worth keeping** (the "gotchas Trappist already paid for"; each with where it lives):

- **Order.** `created_at` defaults to `clock_timestamp()` (`20261110150000_messages_clock_order.sql`); `post_message`
  stamps `greatest(clock_timestamp(), max(created_at) + 1 µs)` per conversation under an advisory lock
  (`20261110160000_messages_written_order.sql`; current body in `schema-snapshot/functions/public.post_message(uuid,text,…).sql`).
- **Idempotent send.** `unique (sender_id, client_id)` (`messages_client_once`); `post_message` takes
  `pg_advisory_xact_lock('message_sender:'||uid)`, returns the existing row on a retry, refuses a reused
  `client_id` for another conversation or kind (`message_client_id_reused`).
- **Race with removal.** After the sender lock it takes `message_conversation:<id>` and checks `conversation_writable`
  again, so a message that passed the gate while an admin was removing her is refused, not written after she left
  (comment in `post_message`).
- **Rate limit.** 30 messages a minute counted inside `post_message`; groups and adds have `chat_group_rate_log`.
- **Replies stay inside their thread** (`message_reply_unavailable`).
- **Chapter comments are messages with `chapter_id`**; `group_messages_readable` returns the group chat only unless a
  chapter is asked for, so `inbox()` and unread counts ignore chapter comments without being touched
  (`20270509120000_buddy_reads.sql`, 107 KB, the largest file; see also `groups.md`, "As built in G11").
- **Realtime auth.** Policy `realtime_member_topic_select` on `realtime.messages`: a member may join her own topic
  `member:<id>` only, there is **no insert policy**, only triggers send (`20261110140000_realtime_member_channels.sql`).
  `messages_broadcast_new` sends the **whole row** to every active member through `group_recipients` (blocked pairs left out);
  event name `message.new` or `chapter.message.new` (`schema-snapshot/functions/public.messages_broadcast_new().sql`).
  Trappist has 13 typed events (`data/realtime.ts`, `RealtimeEvent`); the chat's are `message.new/read/reaction`,
  `chapter.message.new/read/reaction`, `group.changed`, `group.invitation`, `buddy_read.changed`, `message.hidden`.
- **Media.** Private bucket `chat-media`, 2 MB, jpeg/webp/gif, path `{conversation}/{sender}/{uuid}.ext`
  (`20270112120000_chat_media.sql`); storage policies `chat_media_insert_own`, `…_select_parties`, `…_delete_own`
  (`schema-snapshot/policies/storage.objects.sql:23–30`); the object must exist with a matching type and be hers before
  `send_media` accepts it. Deleted messages and accounts queue paths in `chat_media_trash`; the hourly cron
  `sweep-chat-media` (`schema-snapshot/cron/jobs.sql`) calls the Edge Function `chat-media-sweep`
  (`index.ts` 80 + `sweep.ts` 60 lines, pure and tested). GIFs are **not** stored: `messages.media_url` holds KLIPY's
  address and the database accepts only `https://static*.klipy.com/…` (`20270305120000_klipy_gifs.sql`, constraint
  `messages_media_shape`).
- **Reports.** `report_chat_message(uuid,text,text)` writes `reports.message_id` with an excerpt that names the chapter
  (`chapter_label`); reasons are fixed (`reports_reason_known`: belaestigung, spam, unangemessen, fake, sonstiges);
  the Orga (Trappist's admin) can hide and unhide (`admin_hide_message`, `messages.hidden_at`).
- **Blocks.** Symmetric and silent (`20261201120000_blocks.sql`; `blocked_between`, `visible_between`). Inside a group
  nobody is removed; the two stop seeing each other's messages and reactions (`groups.md`, D6).
- **Push.** A general pipeline: `push_events` + `push_wanted` + `push_enqueue(_many)` + the Edge Function `push`
  (`index.ts` 159, `payload.ts` 342 lines) + `web/public/push-sw.js` (331). Kinds include `group_message`,
  `chapter_reply` (only when someone answers *your* comment, D22), `group_invite`.

**Size.** About 110 of Trappist's 332 database functions match chat, group, buddy, conversation, message or reaction
(about 3,600 lines of function bodies; a few are Feed reactions). The chat-related pgTAP files total 4,452 lines
(`messages_test.sql` 369, `message_reactions_test.sql` 206, `chat_media_test.sql` 247, `chat_voice_test.sql` 283,
`message_reply_test.sql` 215, `chat_groups_test.sql` 1,190, `buddy_reads_test.sql` 831, `reports_test.sql` 391,
`realtime_test.sql` 377, `klipy_gifs_test.sql` 138, `chat_media_sweep_test.sql` 205, all in `trappist:supabase/tests/`).

### 1.3 Edge functions

- **`gifs` is gone.** KLIPY's terms ask that requests and media come from the member's phone and that nothing is copied or
  proxied, so the picker talks to KLIPY directly (`trappist:web/app/data/klipy.ts`, 244 lines; its header says so).
  Functions today: `books`, `chat-media-sweep`, `push`, `screens`, `send-auth-email` (`trappist:supabase/functions/`).
  The old plan's "port the `gifs` function, or a Pages function proxy" is dead.

### 1.4 Client code

| Piece | Path (trappist:web/…) | Lines | Generic or domain |
|---|---|---:|---|
| Send queue (outbox, order, back-off, `client_id`, refusals, Web Locks tab ownership) | `layers/chat/app/utils/queue.ts` (re-exported by `app/data/saveQueue.ts`, `queueOwnership.ts`) | 537 | **generic**, in the layer; storage and the send are injected |
| Thread merge by `clientId`, runs, unread after a cursor | `layers/chat/app/utils/thread.ts`, `composables/useThread.ts` | 127 + 23 | **generic**, in the layer; imports only `@fabkho/ui/pure/timeline` |
| Spoiler veil (`chapterOpen`, `chapterView`, `mayLoadMedia`, peeks in `localStorage`) | `layers/chat/app/utils/veil.ts`, `composables/useBuddyRead.ts` | 105 + 51 | **generic** (rule: "drawn by the app, not enforced by the database") |
| Chapter division (count with grouping, pages) | `layers/chat/app/utils/chapters.ts` | 102 | generic; the server repeats the arithmetic (`set_buddy_chapters`) |
| Call-card state machine | `layers/chat/app/utils/inviteState.ts` | 44 | **Trappist** (the Feed call: `authorWaiting`, `authorCanCreate` …), sits in the layer anyway |
| Adapter contract (`ChatAdapter`, `GroupAdapter`, `BuddyReadAdapter`, `InviteAdapter`) | `layers/chat/app/types/adapter.ts` | 140 | generic, types only; `live()` abstracts the transport |
| **Realtime wrapper** (join a private topic, status, resync on rejoin, a 3 s cold-start resync, replace a dead iOS-PWA socket on `online`/`visibilitychange`) | `app/data/realtime.ts`, `app/stores/realtime.ts` | 279 + 196 | mechanics **generic**, but the event union carries Feed and connection events, imports `toMessage` from `data/chat.ts`, and the store is Pinia. **Not in the layer.** |
| Photo prepare (≤ 1600 px, 1280 in groups, JPEG ≤ 2 MB, EXIF/XMP strip for Safari's encoder) | `app/data/photo.ts` (`data/chatPhoto.ts` is a 3-line re-export; the Feed uses it too) | 177 | **generic**, framework-free, tested. Not in the layer. |
| GIF client (search, trending, share count, response mapping, `customer_id`) | `app/data/klipy.ts` | 244 | generic provider code, with `LOCALE = 'de'`, German topic chips and `translateChatError` baked in. Not in the layer. |
| Repository (RPC wrappers, signed URLs `MEDIA_URL_SECONDS` = 15 min, error mapping) | `app/data/chat.ts`, `groups.ts`, `buddyReads.ts`, `inbox.ts` | 711, 515, 267, 396 | **per app**: it *is* the adapter's implementation; German error sentences, `Gelöschtes Mitglied` |
| Chat store (optimistic send, uploads, signing, quotes, reactions, drafts, cursors, phone share, `companions`) | `app/stores/chat.ts` | **1,848** (1,094 in the old plan) | per app (Pinia); the largest un-shared piece; 1:1 parts (`companions`, `readKey`, `phone_share`) |
| Chat screen | `app/components/chat/ChatPage.vue` (+ `ChatGroupHead/Info/Mute`, `ChatSystemLine`, `ChatBookCard/Sheet`) | 997 (+ 461 info) | per app: composes `UiChatThread` + `UiBubble` + `UiComposer`; head, menus, report, Orga |
| Buddy read screens | `app/pages/lesen.vue`, `app/stores/buddyRead.ts`, `app/components/buddy/*` (pill, marker sheet, chapters sheet, insert, edit) | 323 + 324 + 573 | per app copy and flows; the chapter row is `UiThreadRow` in the base |
| Private-image cache rule (path-keyed Workbox cache so a re-signed URL is the same picture; the egress lesson) | `app/utils/storageCache.ts` | 131 | generic idea, wired into each app's own `nuxt.config.ts` Workbox config |
| Copy | `app/copy/chat.ts`, `groups.ts`, `buddyRead.ts` | 252 + 169 + 216 | **German only**, plain TS modules (no i18n); the base's words are `ui.text.chat.*` |

**Tests.** Vitest, chat-related: 19 files, 3,963 lines (e.g. `tests/realtime.test.ts` 244, `chat-layer-queue.test.ts` 315,
`chat-layer-queue-ownership.test.ts` 384, `klipy.test.ts` 282 with recorded answers, `chat-media.test.ts` 251,
`buddy-reads.test.ts` 320, `chat-store-buddy.test.ts` 233). The layer's own are 1,348 lines in 7 files, plain Node. The guard
`tests/chat-layer.test.ts` (120 lines) fails the build if a layer file imports the app, Pinia, Supabase or an auto-import, or
mentions a domain word.

### 1.5 What is coupled to Trappist's domain, what is generic

- **Domain, not for Libellus:** 1:1 connections (`conversations.connection_id`, `kind connection|host`, `connections_open_conversation`),
  phone sharing (`member_phones`, `share_phone`, `ChatPhoneCard/Sheet`, `messages.kind = 'phone_share'`), the Feed call as
  the way into a group (`feed_book_joins`, `create_buddy_group`, `join_buddy_group`, `source_post_id`, `inviteState.ts`),
  the Orga and bans (`visible_between` includes bans and hidden admins; `admin_hide_message`), the book card in
  messages (`message_book_valid`, `bookMoment.ts` 279), groups by hand with admins, history windows, mute, group picture,
  German copy, `profiles`/`accounts` as identity, `profiles_before_delete` anonymisation.
- **Generic:** the send contract (`client_id`, order, rate limit, idempotency), the membership-gated reader, per-thread
  cursors, reactions, GIF provider, photo preparation, media policy shape, sweep, Realtime mechanics, the veil rule, the
  chapter arithmetic, the presentational UI, the scroll anchoring and day grouping (inside `UiChatThread` /
  `ui:app/utils/chat/timeline.js`).

---

## 2. A layer-by-layer sharing map

### (a) Presentational UI: shared already, nothing to extract

`@fabkho/ui` at `origin/main` has, as components: `UiChatThread` (811 lines, runs, scroll anchoring, `banner` slot),
`UiBubble` (996; `sender`, `face` slot, `veiled` + `reveal`, `wide`, `actions`), `UiComposer` (517) + `UiComposerChip`,
`UiReactionBar` (227; **one** lit emoji, "a tap picks one, the same again takes it back"), `UiGifPicker` (258; takes a
`search(q, page, topic)` function and `feeds`, so it is provider-agnostic), `UiMediaViewer` (346), `UiQuote`, `UiVoiceBubble`,
`UiDaySeparator`, `UiAvatarStack`, `UiCheckList` (member picker), `UiThreadRow` (chapter/section row, a veiled row never has
its title), `UiImageCrop`. Pure helpers under `app/utils/chat/` (`timeline.js` 170, `reply.js`, `voice.js`, `message.ts`,
`gif.ts`, `words.ts`), reachable as `@fabkho/ui/pure/<name>`. Stories carry axe and keyboard tests. Words are
`ui.text.chat.*` (`ui:app/app.config.ts`), set by the app from its messages; **Libellus already does this**:
`web/app/utils/uiText.ts` lists the chat, `checkList`, `imageCrop` and `threadRow` keys and `tests/ui-text.test.ts`
fails when the base adds a word without a line.

Libellus' own rule applies unchanged (`web/AGENTS.md`): "Look there before writing a component … nothing of the app
replaces [the base]". One known knob: `ui.config.ts` holds back the base's `no-focus-zoom` plugin and says "once BetterReads
takes the base's composer, it comes back with it" (Trappist's 15 px composer needs it against iOS' focus zoom; Libellus' fields are 17 and 19 px).

What may still need the base: a **radio row** (Trappist's follow-up: `BuddyMarkerSheet` and `ChatGroupMute` are radio rows
in a sheet; `UiRow` has no radio mode), and a **multi-reaction** bar if the owner wants several emoji per member (Q13).
Both are small base PRs under the base's own rules (story, axe).

### (b) Client logic: where the real sharing is

| Piece | Share? | How, and what must change first |
|---|---|---|
| queue, thread, veil, chapters, adapter types | **yes, already in the layer** | extract as is; rename `chapterId` to a neutral word before 0.1.0 if Libellus' "Section" matters in types (Q3); keep words out (the guard already does) |
| `inviteState.ts` | **no** | Trappist's call card; move it back into the app before the split |
| Realtime wrapper | **yes, the high-value one** | split mechanics from domain: `liveChannel({ loadRealtime, topic, parse })` with the join, status, resync on rejoin, 3 s cold-start resync and dead-socket replacement; Trappist's event union and Pinia store stay in the app. The loader is **injected**, because Libellus must reach the real client only through `#realtime-client` (`web/realtime.config.ts`, `web/AGENTS.md` "Gotchas": a new Realtime use "goes through that door, never through `client.channel()`; keep it lazy and off the entry") |
| Photo prepare | **yes** | move `photo.ts` into the layer unchanged (framework-free). Libellus has its own `data/avatar.ts` (424 lines, strips EXIF/XMP/ICC/IPTC from an avatar of at most 256 kB) and `utils/avatarRaster.ts`; leave them, adopt `photo.ts` only for chat photos |
| GIF client | **yes** | parametrise `locale`, topic list and error sentences (today `LOCALE = 'de'`, German chips, `translateChatError`); keep the recorded-answer tests |
| Error codes | **yes, codes only** | the SQL raises stable keys (`message_rate_limited`, `buddy_read_archived`, `message_client_id_reused`, …); the layer exports the key list, each app words it (Trappist: `data/chat.ts` `translateChatError` / `CHAT_ERROR_KEYS`; Libellus: `en.json` + `de.json`) |
| Repository (`data/chat.ts` …) | **no** | per app; it is the adapter |
| Stores, pages, sheets | **no, for now** | the chat store is 1,848 lines in Trappist; Libellus writes a smaller one on the layer's `queue`/`thread`. What the two stores then *both* contain is the next extraction (a `thread engine` in the layer), by evidence, not by guess |
| Private-image cache rule | later | only needed if Libellus serves private chat photos (Q15); then copy the 131-line rule into its Workbox config |

### (c) The database: SQL cannot be an npm package

Options compared for this owner (solo, two schemas that differ at the identity table, the block and visibility predicates,
the rate-limit style and the "RPC only" rule):

| Option | What it is | Cost | Verdict |
|---|---|---|---|
| **1. Port by hand, Trappist's snapshot and pgTAP as the spec** | A worker writes Libellus-native migrations from `schema-snapshot/functions/…` and `supabase/tests/*`, with a header comment naming the Trappist commit and a checklist of behaviours to keep (part 1.2). | About 25–30 functions and 3 migrations for the Libellus shape; its tests start from Trappist's. No tooling. | **Recommended.** Matches Trappist's own plan and the migration rule in `AGENTS.md` (an applied migration is never edited; each repo evolves alone). |
| 2. Copy with a sync script | A script pulls named functions from Trappist's snapshot into a new Libellus migration. | The bodies reference `profiles`, `accounts`, `conversation_party`, `visible_between`, `blocked_between`; a search-and-replace is brittle, and a re-sync after an applied migration is a *new* migration of a diff. | No. |
| 3. Template generator | `fabkho/chat` ships `.sql.tpl` plus a hook file (member table, `can_write`, `can_read`, `blocked`), and a generator emits a dated migration and the pgTAP. | A week or more; the generator needs diff-and-upgrade logic to respect "never edit an applied migration"; only pays with a third app or frequent SQL change. | Not now. Revisit if a third app appears. |
| 4. A shared Postgres extension (database.dev / `pg_tle`) | Versioned, installable SQL with upgrade scripts. | From general knowledge, not tried here: objects live in the extension, the snapshot and drift checks of both repos (`supabase/schema-snapshot/`, CI "stale snapshot") would have to understand them, local stack parity is unproven, and the hooks would have to be config tables or functions in `public`. | No. |
| 5. A reference-SQL folder in the shared package | The snapshot functions copied under `fabkho/chat/reference/sql/` for reading, never applied. | Option 1 plus a place to read from without access to the private Trappist repo. | **Add it to option 1**, if the package is public (Trappist's repo is private, Libellus' is not). |
| 6. Accept the duplication | Same as 1, without the checklist. | The bugs repeat (ordering ties, the removal race, the replay of a `client_id`). | No: the checklist is the point. |

Libellus-specific SQL that has no Trappist counterpart is listed in part 4.

### (d) Edge functions

- `gifs`: gone (part 1.3). Libellus needs **no** server part for GIFs; it needs a KLIPY app key of its own, the attribution
  ("Powered by KLIPY", `trappist:docs/parity.md` around line 874), a row in `docs/THIRD-PARTY.md`, a line in
  `web/app/legal/privacy.ts` and CSP entries (`connect-src https://api.klipy.com`, `img-src https://static*.klipy.com`;
  `web/public/_headers` has a Report-Only policy today).
- `chat-media-sweep`: **copy the shape, do not share.** The pure part (`sweep.ts`, 60 lines) has no domain; the SQL it calls
  (`chat_media_sweep_batch`, `chat_media_sweep_done`, the trash table) belongs to the schema. Only needed if Libellus gets photos.
- `push`: Libellus has its own Web Push sender for the import job (`supabase/functions/import-job/push.ts` 158 lines,
  `webpush.ts`) and Trappist has another (`supabase/functions/push/`). **Two implementations of the same RFC 8291 sender**
  already exist. Out of scope for this plan; worth one line in the owner's backlog.

### (e) i18n copy

Trappist's copy is German-only TypeScript (`app/copy/*.ts`, 637 lines for chat, groups and buddy reads) and cannot move.
The shareable words are the base's English defaults and `ui.text.chat.*`, which Libellus already translates. Libellus'
own screens follow its rule: a key in `web/i18n/locales/en.json`, German by `pnpm i18n:translate`, both files and
`.i18n-kit.lock.json` committed, the parity test (`web/AGENTS.md`). Trappist's German is a useful glossary only: *Buddy-Read*,
*Kapitel*, *Das ganze Buch*, *Bis Kapitel n gelesen* (`trappist:web/app/copy/buddyRead.ts`).

---

## 3. Sharing mechanisms compared, and a recommendation

Precedents in the owner's repos, read, not assumed:

- **`@fabkho/ui`** (public, MIT): a git dependency pinned to an exact tag (`web/package.json:44`,
  `"@fabkho/ui": "github:fabkho/ui#v0.10.6"`; Trappist is on `v0.10.5`), release-please makes the tag, `ui-bump.yml` opens a weekly bump
  PR in each app (`.github/workflows/ui-bump.yml`, `docs/DEVELOPMENT.md` "The UI base bump"), the app reaches it as `#layers/ui`
  and `extends: uiLayer()` with `UI_LAYER=/path` as a local override (`web/ui.config.ts`). `web/AGENTS.md`: "pinned to a tag, never a branch".
- **Regal** (public now, `gh repo view fabkho/regal`): a Nuxt layer pulled by giget from the **default branch**, opt-in by
  `LIBELLUS_REGAL=1`, with `GIGET_AUTH` and `REGAL_LAYER=/path` (`web/regal.config.ts`). No version pin, a flag, a token path. The weaker
  precedent for a layer the app cannot build without.
- **foliate-js** vendored with a `VENDORED.md` (`web/app/reader/foliate-js/`): the old plan's model for a copy.

| | **A. Chat components into `@fabkho/ui`** | **B. `fabkho/chat`, a tag-pinned Nuxt layer (the `ui` way)** | **C. Monorepo** | **D. Vendor + sync script** | **E. Copy once** |
|---|---|---|---|---|---|
| What moves | presentational pieces only | layer today (1,136 lines + 1,348 tests) + Realtime core, photo, GIF client, error codes (about 2,000 lines + tests) | everything | the same as B, as files in both repos | the same as B, once |
| Already done? | **yes** (19 Oct, #298) | designed and guarded in Trappist, not split | no | no | no |
| Release cost | none new | one more repo: release-please, a vitest CI job (public repo: free minutes), a tag per release; `ui-bump.yml` generalised to two packages | one repo, one pipeline, huge move | none, but every sync is a manual PR | none |
| A change in one app reaches the other | a bump PR (weekly or by hand) | the same | immediately | when someone runs the script | never |
| CI and tests | story + axe in the base | plain-Node vitest travels with the package; the guard test moves with it | one big CI; Trappist's 3,000-minute private pool (`trappist:docs/CI.md`) vs Libellus' free public minutes | tests copied | tests copied |
| Risk of coupling the two release trains | low (UI is already coupled) | **low with exact pins**; a breaking `adapter.ts` change reaches an app only when it bumps. The layer imports `@fabkho/ui/pure/timeline` (one 5-line function, `compareCreated`): inline it or declare a peer range, or the two trains meet | **high**: Trappist is private, Libellus public; one deploy story for two products | medium: drift is silent | high over time |
| Effort in PRs | 0–2 (radio row, multi-reaction) | Trappist 2, new repo 1, Libellus 1 | many | 1, then one per sync | 1 |
| Verdict | **yes for anything presentational, no for logic** (the base's README says it is "props in, events out", and "no queue" until this work) | **recommended** | no | a fallback if B stalls | no (the old plan's choice, made when Trappist had 1:1 chat only) |

### Variant B′: put the layer inside `fabkho/ui` as a second entry

It avoids a repo, but it breaks the base's identity ("presentational: no store, no data", `web/AGENTS.md` "Portable by default";
the base README's "Chat and the send queue" section keeps the queue out on purpose), ties the chat's releases to the
base's Storybook CI, and whether Nuxt resolves a sub-layer from `node_modules/@fabkho/ui/<dir>` as `#layers/chat` is **not verified**
here (it would take a 20-minute spike). Not recommended; B is a cleaner seam.

### Recommendation

**Finish Trappist's own plan, with Libellus as the second consumer.** Concretely:

1. **Prep in Trappist (1 PR, normal tier).** Move into `web/layers/chat/`: `photo.ts`, `klipy.ts` (parametrised), a
   `liveChannel` extracted from `data/realtime.ts` and `stores/realtime.ts` (injected `loadRealtime`), the error-code list; move
   `inviteState.ts` out; decide the `chapterId` name; keep the guard test and extend it to the new files. Trappist's own app keeps
   working through re-exports at the old paths (the way `saveQueue.ts` does today).
2. **Split (1 small PR chain).** `git subtree split --prefix web/layers/chat` → public `fabkho/chat` (MIT, like `ui` and `regal`;
   the layer holds no secrets and, by its guard, no Trappist word), v0.1.0 by release-please, a vitest job, a README with the
   adapter contract. Trappist swaps its local folder for the tag-pinned dependency in one PR (alias `#layers/chat` stays, as
   `#layers/ui` does for a `node_modules` layer).
3. **Libellus adopts (1 PR before any feature).** `@fabkho/chat` pinned exactly, `extends`, the lazy Realtime door, a test that
   the entry chunk still holds no `realtime-js` (the build already fails if the entry imports a Regal chunk, `web/AGENTS.md`; the `realtime` chunk is named in
   `nuxt.config.ts`), `ui-bump.yml` generalised.
4. **Libellus builds its own side**: migrations (hand-ported, part 2c), its adapter implementation in `web/app/data/`, a
   small Pinia store on the layer's queue and thread, screens from the base. What its store and Trappist's store then both contain
   is the *next* extraction, 0.2.0, with a real second consumer's evidence.
5. **In parallel with 1–3:** Libellus' database work has no dependency on the package and can start the day the owner answers.
6. **Only then**, the features the old plan staged late (photos, push, saved chapter lists, ebook chapters), each its own PR.

**The split line.** Shared: the base's UI; the layer's queue, thread merge, veil, chapter arithmetic, adapter types, Realtime
mechanics, photo preparation, the GIF client, error codes. In each app: SQL, repositories, Pinia stores, pages and sheets,
copy, entry and invitation flow, reports and moderation, push, member identity, privacy text.

**What I would not share:** SQL (no generator, no extension); the 1,848-line chat store (extract its common core later, by
evidence); the group-chat product (admins, history windows, mute, group picture, hand-made groups, the Feed call), the book
card, the Orga; Trappist's push pipeline (Libellus' needs are a later, separate decision); `storageCache.ts` before photos exist;
a shared Supabase project (two audiences, two plans, two sets of rules).

**Biggest risks.**

- *The layer was designed for one consumer.* Shapes such as `inviteState`, a marker as an integer, `chapters_from` count/pages
  may be Trappist-isms. Mitigation: Libellus writes its adapter against 0.1.0 and anything it cannot express goes into 0.2.0,
  while both apps are still small consumers.
- *Trappist's chat is a moving target:* its `stores/chat.ts` was touched 17 times since 8 October. The layer's API may
  move weekly. Mitigation: exact pins, bump PRs reviewed like releases.
- *Visibility.* Trappist is private and Libellus is public. The package must be public; check the layer files for anything
  personal before the split (the guard bans domain words; it does not ban German strings or e-mail addresses).
- *Free plan.* Libellus' hosted Supabase is on **Free** (`docs/OPERATIONS.md`, "Backups"; Trappist is on Pro). Trappist measured
  7.0 GB of cached egress for 20–40 members on Free's 5 GB (`groups.md`, "What exists today", Storage row). Photos are the cost
  driver; the rest fits (part 5).
- *Progress leaves the database for the first time.* Social v1 promises "What never leaves … her progress"; a marker shown to co-members
  breaks it unless it is explicit and coarse (`web/app/legal/privacy.ts` and `docs/legal-checklist.md` change in the same PR).
- *Two spoiler models.* Choosing server gating later costs a stubbed reader RPC and a second code path; the veil hook
  (part 4) keeps that door open without paying for it now.

---

## 4. What buddy reads need that Trappist does not have, and the room the shared design must leave

| Need | Trappist today | Libellus needs | Room in the shared design |
|---|---|---|---|
| **Membership** | groups ≤ 30, admins, entry by Feed call (derived invitation, `join_buddy_group`) or by hand | a buddy read of ≤ 12 whose members are people she follows; **invitations, an invite link** `/t/<token>` (128 bits, copy of the follow link: `social_settings.follow_token`, `pages/f/[token].vue`, `utils/pendingFollow.ts`, `follow_target`), join, leave, host handover | `InviteAdapter.join/dismiss` (already a link-or-invitation contract); drop `inviteState` from the layer |
| **A Book** | a snapshot of title, author, cover, ISBN, no catalogue FK (`buddy_reads.book_*`) | `books.id` of a Catalogue Book (Manual books are private and cannot be shared, `CONTEXT.md`), her `library_entries` row, covers through `coverImage()` (own covers, `docs/covers.md`) | layer never sees a Book; `BuddyReadData.book` stays `{title, author, cover}` |
| **Sections and where they come from** | count or page ranges, renamable, insert a custom one (`set_buddy_chapters`, `add/rename/remove_buddy_chapter`; no Open Library: D18) | those, plus *her ebook's table of contents* (`web/app/reader/engine.ts` `TocItem {label, href, depth, fraction}`, line 32) and *a list saved by an earlier read of the same Book* (old plan §D, whose probes found no usable chapter data for German in-copyright books) | extend `ChapterPlan` with `from: 'list'` (explicit titles and pages), additive; `chapters.ts` stays arithmetic |
| **Spoiler anchors** | **none per message.** A hand-set marker opens threads up to chapter n; `spoiler` flags one message; the database gives every member every comment (`veil.ts` header) | the old plan wanted a server gate per message by anchor, from her automatic position | a **visibility hook** in the layer: `(record, viewer) → show | veil | hide`, default = Trappist's chapter rule; `ChatRecord` gains an optional `hidden` stub (no body, no media) that `UiBubble veiled` already draws. Server stubs become possible later without a layer change |
| **Her position** | she sets "Bis Kapitel n gelesen" by hand; "nothing here tracks reading" (`groups.md`, "Buddy reads") | automatic from her linked entry (`reading_sessions.progress_page` / `progress_percent`, the reader's `fraction`), with a hand override | the layer's `veil.ts` takes a marker *number*; where it comes from is the app's. `BuddyReadAdapter.setMarker` stays; an app-side trigger can write it |
| **Per-Section unread** | `buddy_read_cursors` per chapter; the pill counts across open chapters | the same | nothing to add; `mark_read(conv, up_to, chapter)` is the model |
| **Moderation** | admins (several) remove members; the **Orga** hides a message; members cannot delete or edit their own ("no editing or deleting in v1", `groups.md`, "Chapter threads") | the **host** removes members and may delete any message; members delete their own (old plan: tombstone, body and media cleared) | `ChatAction` gets `deleteOwn`, `deleteAny`; `UiReactionBar` `actions` already carries the entries |
| **Reports** | `report_chat_message` → `reports` → the Orga screen | the owner's inbox `public.feedback` (`20261024010000_feedback.sql`, `feedback_list`, `private.feedback_rate_limit()`) with a new kind `report` and the message and Section attached; no admin screen | `GroupAdapter`/`ChatAdapter` have no `report`; the app wires it to the bar's `actions` |
| **Reactions** | one of six emoji per member, written straight into the table under RLS | one per member (the base's bar) written through an RPC (Libellus has no table grants) | `react(messageId, emoji \| null)` is already one-per-member |
| **Blocks** | silent and symmetric inside a group (D6) | `private.blocked_either`, `reachable`, `visible` (`supabase/schema-snapshot/functions/private.*`); never invite across a block; a block never revealed | the filter lives in the SQL reader; nothing in the layer |
| **Account deletion, export, privacy** | `profiles_before_delete` anonymises; `export_my_data` lists her messages | `delete_my_account` already refuses with `photo_remains` while files remain; no export exists yet; `legal/privacy.ts` EN and DE, `docs/legal-checklist.md`, `docs/THIRD-PARTY.md` | none |
| **Push** | `chapter_reply` etc. through the general pipeline | Libellus' push is import-only (`push_subscriptions` migration `20261106010000`, `import-job/push.ts`, `public/sw-push.js` 63 lines, `stores/importPush.ts`); it has no events table, no kinds, no preferences | none; decide in Q18 |
| **Live transport** | one topic per member, whole row per recipient | the old plan: one topic per buddy read, a *nudge* (ids only), read through the RPC so one SQL gate serves every client | `ChatAdapter.live(on)` hides the topic shape. Q6 |

---

## 5. What changed in BetterReads since the old plan

Read at `78e974e4` (1 November 2026). The old plan said it was measured against `438b0d9f`, 12 October.

- **UI is the shared base.** The local copies are gone (`887a54ae`, #392, "the last local copies of the UI base go, on v0.6.0"),
  the app reaches it as `#layers/ui` (#389), pinned `v0.10.6`; a weekly bump PR (`.github/workflows/ui-bump.yml`). The base has
  the chat, `UiThreadRow`, `UiCheckList`, `UiImageCrop`. *Stale:* old §E "Trappist's UI layer is Libellus' design system
  (`docs/ui-layer-plan.md` there)" and every "copy `ChatMessage.vue` …" row.
- **Migrations are numbered `202611…`** and the latest is `20261112010000_hardcover_covers.sql` (100 files). Old plan:
  "the latest on main is `20261027010000_fill_book_covers.sql`", PR 1 `20261028010000`, PR 4 `20261028020000`. Renumber on top of `20261112…`.
- **`supabase/schema-snapshot/` and CI.** After a migration, `pnpm schema:snapshot` and commit it; CI fails on a stale
  snapshot; `release.yml` warns about drift (`AGENTS.md`). A pull request that edits or deletes an applied migration fails CI.
  New for any DB PR, not in the old plan.
- **Web Push exists, for the import only**: `supabase/migrations/20261106010000_push_subscriptions.sql`,
  `supabase/functions/import-job/push.ts` (+ `webpush.ts`), `web/public/sw-push.js`, `web/app/data/pushSubscription.ts` (181),
  `web/app/stores/importPush.ts` (#398). *Stale:* old §A "No push and no in-app notifications" (the lamp dot is still the only in-app indicator).
  The old plan's option C "web push" is no longer from zero, but there are no kinds, events or preferences.
- **Realtime has a door.** `web/app/data/importJobFeed.ts` (115 lines) loads the real client lazily as `#realtime-client`
  (`web/realtime.config.ts`), in its own `realtime` chunk that is not precached (`nuxt.config.ts`); `AGENTS.md` makes it the rule for any new use.
  *Stale:* old §C "lazy-imports the real `RealtimeClient` by its file path (a regex alias …; to prove in PR 5)" and the old measured 17.2 KB gzip stands as the lazy chunk's size.
- **Own covers** (`20261108010000_cover_store.sql`, `…cover_read_path`, `…cover_gc`, `supabase/functions/cover-store/`, `/c/<key>/<width>`
  via R2, `coverImage()` in the UI; off by default, `NUXT_PUBLIC_OWN_COVERS`): a buddy read's cover must be drawn through
  the same helpers; still **one Supabase Storage bucket** (`avatars`, `20261009120000_avatars.sql`), so the old claim holds and
  covers did not add a bucket.
- **App-update sheet** (`e68b43f4`, #354; `web/app/stores/appUpdate.ts`): "a new release is offered, never swapped in under
  the page". An open thread can therefore talk to a newer database than its bundle: RPC changes must be additive.
- **Sentry** (#440, `805f6887`; `web/app/utils/sentry*.ts`): "anything new that can reach an event goes through `scrubEvent`".
  A message body must never reach an event; the old plan's "watch `client_errors` for `/together/*`" is now partly Sentry.
- **Social v2a, follows, blocks, `feedback`**: all pre-date the old plan and are unchanged (`20261017…` to `20261025010000_social_v2a.sql`,
  `20261024010000_feedback.sql`, `20261025040000_book_readers.sql`); the old plan's §A on them is still right.
- **The reader, i18n, outbox**: foliate reader and `TocItem` (`web/app/reader/engine.ts:32`) unchanged; i18n EN/DE is a key file
  pair of 2,226 lines each with `pnpm i18n:translate` and a parity test (the old plan wrote German drafts by hand);
  the outbox (`web/app/data/outbox.ts`, 395 lines, IndexedDB, `sync_write`) is a *library* outbox and stays separate from the chat queue.
- **Hosting and visibility.** Libellus' repo is public (`gh repo view fabkho/libellus`), as are `fabkho/ui` and `fabkho/regal`;
  Trappist is private. Supabase: **Free** (`docs/OPERATIONS.md`, "Backups"); Trappist moved to Pro.
- **Docs rules** (`AGENTS.md`): README holds no setup; operations go in `docs/OPERATIONS.md`, `HOSTING.md`, `SETUP.md`,
  `THIRD-PARTY.md`; plans in `docs/plans/`; each screen a `docs/parity.md` entry.
- Not related, and ignored: import server job, Hardcover, new logo and launch takeover, the chart.

### Statements in the old plan that are now stale

| Old plan | Now |
|---|---|
| Intro and §E: "Trappist's chat is strictly 1:1", "The data model must be new" | groups, buddy reads, chapter threads, markers exist (G0–G12) |
| §E: copy `ChatMessage.vue`, `ChatComposer.vue`, `ChatReactionBar.vue`, `ChatGifPicker.vue`, `ChatMediaViewer.vue`, `timeline.ts` | deleted 19 Oct (#298); they are `UiBubble`, `UiComposer`, `UiReactionBar`, `UiGifPicker`, `UiMediaViewer`, `@fabkho/ui/pure/timeline` in `@fabkho/ui` |
| §E: "`supabase/functions/gifs/index.ts`, `giphy.ts`, GIPHY search behind the server" | deleted 8 Oct (#120); the audit read Trappist at `0f3c2af`, the same day, just before. KLIPY, straight from the phone, never copied or proxied |
| §E: `stores/chat.ts` "1094 lines", "far too coupled" | 1,848 lines; the queue it carried is now `layers/chat` |
| §E: "Copy with a `VENDORED.md`, not a shared package now" | Trappist's plan (`groups.md` D25, "Port to BetterReads") prepared the split instead |
| §E: "a send queue … not now … chat is online-only in v1" | the queue is a tested, framework-free layer module; online-only is no longer the cheap option |
| §E: reactions "key `(message, member, emoji)` to allow several" | the base's `UiReactionBar` is one per member; several needs a base change |
| §A/§C: "No push", Realtime stub "to prove in PR 5" | import push exists; the `#realtime-client` door exists |
| §C migration names `20261028…` | `20261113…` or later |
| §D: chapters from saved, ebook, Open Library, pages | Trappist chose count/pages only (D18) after reading this plan's probes; the ebook source is Libellus-only |
| §F/§G: GIPHY, proxy through a Pages function, "Trappist copies instead" | KLIPY terms forbid copy and proxy; open question 5 is answered |
| §H: PR 4 "components/together/Thread*.vue (from Trappist's chat components)" and PR 5/6/7 "from Trappist …" | the components are in the base; the client pieces come from the package |
| §G: "mid-Section, she sees what slower readers wrote, never what faster ones wrote" (a per-message SQL anchor) | not what Trappist built; Q8 |

---

## 6. Questions for the owner

Each has my recommendation; "yes" to all of them is a coherent plan. Questions the old plan asked that Trappist's choices
have answered are listed first and are not asked again.

**Old questions already answered, no action:**

| Old Q | Answer, from where |
|---|---|
| Q2 may co-members see each other's Section | **Yes, coarse:** Trappist D19 shows a face on the chapter row, never a page (`groups.md`). Adopted; the privacy text says so. |
| Q5 GIPHY or KLIPY, proxy or copy | **KLIPY, direct from the phone, never copied or proxied** (`trappist:web/app/data/klipy.ts`). Only Q14 below remains (a key for Libellus). |
| Q10 shared saved chapter lists | **Deferred by Trappist** ("later: one query, worth it once a book comes round twice"). Kept as a follow-up in Q10. |
| Q4 (editing within 15 minutes) | Trappist has neither edit nor member delete in v1. Q12 asks only about delete. |

### A. Sharing

1. **Mechanism.** Finish Trappist's planned extraction: `web/layers/chat` becomes a tag-pinned git dependency `@fabkho/chat`
   (the `@fabkho/ui` way), Libellus is the second consumer. Not a monorepo, not a copy.
   *Recommend yes:* ~2,000 lines of tested logic and every Realtime and photo fix Trappist paid for come with it;
   a copy would be the third copy of a queue (Libellus' outbox, Trappist's, this one).
2. **Home and visibility.** A new **public** repo `fabkho/chat` (MIT, like `ui` and `regal`), not a second entry inside `fabkho/ui`.
   *Recommend yes:* Libellus' CI must install it without a token (the `ui` model); the base keeps "presentational only".
3. **First cut and naming.** Into the first release: queue, thread, veil, chapters, adapter types, the Realtime core, photo
   preparation, the GIF client, the error-code list; `inviteState` stays in Trappist; rename `chapterId` to a neutral
   `threadId` before 0.1.0.
   *Recommend yes:* a rename after two consumers exist is a breaking release; today it is a find-and-replace.
4. **SQL.** Hand-ported by a worker from Trappist's snapshot and pgTAP, with the behaviour checklist (part 1.2) in the PR and a
   header naming the Trappist commit; no generator, no extension, no shared SQL package.
   *Recommend yes.*
5. **Who may touch Trappist, and in what order.** The prep PR (steps 1 and 2 of the recommendation) edits Trappist, which is
   read-only for this plan. May a worker do that on your go, with Libellus' database work starting in parallel?
   *Recommend yes*, with the Libellus UI work waiting for `@fabkho/chat` 0.1.0.
6. **Live transport.** One private topic **per member** like Trappist (`member:<id>`, the whole row to each recipient, 12 messages per post),
   or the old plan's one topic **per buddy read** with an ids-only nudge?
   *Recommend per member:* the layer's resync and cold-start code, and Trappist's `realtime_test.sql`, are written for it; a
   post to 11 others is about 12 Realtime messages, so 1,000 posts a month cost 12 k of Free's 2 M (the old plan's own arithmetic, §G);
   the nudge saves messages Libellus does not need to save, and it needs a second read RPC per event.

### B. Product model

7. **One room or a group product.** A Libellus buddy read is **one Book and one room** (the room's "Before we start" thread is the
   conversation itself, each Section a `chapter` thread), 2–12 members, no groups by hand, no group list, one read per room. The
   tables mirror Trappist's (conversation, membership, messages with a thread id) so the port is mechanical.
   *Recommend yes:* the smaller product Libellus asked for, on the shape Trappist proved.
8. **Spoiler gate (the old plan's per-message SQL anchor vs Trappist's veil).** v1 uses **Trappist's veil**: the database returns the
   Section's messages to members, the client veils Sections ahead of her marker (`veil.ts`, `UiBubble veiled`, `UiThreadRow`), a
   per-message "spoiler" flag exists, the hook for a server stub is left in the layer.
   *Recommend yes:* it is already written and tested; "spoilers here are a courtesy among friends" (old plan §C said the same);
   the stub can come later without a layer change. The price: a determined member reading the API sees everything.
9. **Her position.** Automatic from the progress of her linked entry (page, percent, ebook `fraction`) turned into a Section
   number, with a hand override ("I'm at…") for members without a linked entry; shown to co-members as **the Section only**.
   *Recommend yes:* it is the reason to build this in Libellus rather than add it to Trappist's hand-set marker;
   `veil.ts` needs only the number. It needs the privacy text (progress leaves the database for the first time).
10. **Where Sections come from in v1.** Count or pages (Trappist's, shared), host-editable, "Before we start" and "The whole book" always.
    The ebook table of contents and the crowd-saved list (old Q10) follow as separate PRs.
    *Recommend yes:* the old plan's own probes found no chapter data for German in-copyright books, so count/pages is the common case.
11. **Who invites, who holds the link, how many.** The **host** invites (people she follows, not blocked either way) and holds the
    link; the link is for **members only** (the app is invite-only; a stranger is sent to the waitlist); cap **12**.
    *Recommend yes:* smaller moderation surface (Trappist D3/D21: admins only add and manage), simpler than the old plan's
    "every member may invite", and it answers the old Q1 and Q3 and the member half of Q4.
12. **Deleting messages.** A member deletes her own and the host deletes any (a tombstone: body and media cleared, "Message
    removed"); no editing.
    *Recommend yes:* Trappist has neither, but a host who cannot remove a message has only the report inbox, and the
    base's `actions` slot already carries the entry.
13. **Look and reactions.** Use the base's bubbles (`UiBubble`) and **one reaction per member** (`UiReactionBar`), not the old mock's
    hairline rows and several emoji.
    *Recommend yes:* the base rule is "nothing of the app replaces it"; rows would need a new base component; several emoji
    would need a base change.
14. **GIFs.** Yes, KLIPY direct from the phone, with a **new app key for Libellus** in KLIPY's Partner Panel, the "Powered by KLIPY"
    mark, `docs/THIRD-PARTY.md`, the privacy text and the CSP entries.
    *Recommend yes, after the first release*, not in the first PR.
15. **Photos.** Not in v1; GIFs, text, replies and reactions only.
    *Recommend no photos yet:* Libellus is on Free; Trappist measured 7.0 GB of egress for 20–40 members on Free's 5 GB and
    moved to Pro (`groups.md`). If you want photos: Pro first, or a monthly cap per member (the old plan's 30) and 1280 px.
16. **Retention.** Keep an ended read readable until its last member leaves or deletes her account (the read is then deleted with
    its messages), with no timed deletion.
    *Recommend yes:* that is Trappist's behaviour (archived = read-only, kept); the old plan's 12-month job is a cron and an Edge
    Function for little gain at this size.
17. **Name and entry.** "Buddy read" (English) and "Buddy-Read" (German), as Trappist's German already says; the entry is a *Read together*
    row on the Book page and a Home card; the first release sits behind a Profile → Account switch like the Friends tab, then on.
    *Recommend yes.*
18. **Notifications.** In-app only in v1 (the lamp dot, a Home card, unread counts per Section). No e-mail digest. Push for
    "someone answered you" (Trappist's `chapter_reply`) is its own PR later, on top of a general events table that Libellus does
    not have yet.
    *Recommend yes.*
19. **Reports and blocks.** A message report goes to the owner's `feedback` inbox as a new kind with the message and Section
    attached (no admin screen); blocks follow Trappist's D6: nobody is removed, the two stop seeing each other's messages and
    reactions, and nobody can be invited across a block.
    *Recommend yes.*
20. **Offline sending.** Use the layer's queue (optimistic send by `clientId`, retry with back-off, order kept) instead of the
    old plan's "online-only in v1"; Libellus' library outbox is untouched.
    *Recommend yes:* it is built and tested, and a message typed on a train should not vanish.

---

## What this document is not

It is not the build plan. After the answers, a second turn writes the work packages (order, tiers, files, tests, the
`docs/parity.md` and privacy entries, the `CONTEXT.md` words). Nothing here changes `README.md`, the migrations, Trappist,
`@fabkho/ui` or Regal.
