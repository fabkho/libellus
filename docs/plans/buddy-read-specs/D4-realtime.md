# D4 · Database: buddy read live updates over private per-member topics

**Repo / branch:** libellus, `feat/buddy-read-realtime`. **Base:** `origin/feat/buddy-read-messages` (D3; **stacked**: create the branch from it, open the PR with base `feat/buddy-read-messages`, retarget when D3 merges; if D2 has merged into the base by then, rebase on it). **Tier:** normal at `high` (Sonnet 5.5, `high`). **Size:** M. **Depends on:** D3 (and through it D1). D2 is **not** required: a Section change is detected on the member row's `read_through`, whichever wrote it (hand or progress).

## Task

Make a buddy read live: the database sends events to each member's **private** channel `member:<her id>` when a message is posted or deleted, a reaction changes, a member joins/leaves or her Section changes, the Sections or status change, or someone is invited. Only the database may send; only she may join her own topic. This is the first Realtime Authorization policy in this repository (`grep -rn "realtime.messages" supabase/migrations` is empty on `main`). Read first: plan **part 4.4** (the policy, the event table, the payload rules) and part 9.5 (why hosted behaviour is the open point); Trappist, read only, as the model: `/Users/fabkho/code/trappist/supabase/migrations/20261110140000_realtime_member_channels.sql` (the policy and the triggers), `supabase/schema-snapshot/functions/public.messages_broadcast_new().sql`, `…/public.group_recipients(…).sql`, and its pgTAP method in `supabase/tests/realtime_test.sql` (joining a topic is "set `realtime.topic`, then `select` from `realtime.messages` as the member"; sent events are rows of `realtime.messages`); `web/app/data/importJobFeed.ts` in this repo (the existing, separate postgres_changes feed: it must keep working).

## First, on the local stack

`supabase migration up` (D1 and D3 must be applied), then `supabase test db` on the base branch as the baseline.

## Change

1. **Migration** `supabase/migrations/20261113040000_buddy_read_realtime.sql` (renumber if needed; unique and ordered is enough). Header: topic shape, events, payloads, what it leaves out, and the dashboard setting the owner must change (below).
2. **`private.member_topic(p_member uuid) returns text`** (`'member:' || p_member::text`, immutable, pinned `search_path`; `execute` revoked from public/anon/authenticated).
3. **The policy** on `realtime.messages`: `create policy buddy_member_topic_select on realtime.messages for select to authenticated using (extension = 'broadcast' and (select realtime.topic()) = private.member_topic((select auth.uid())))`. **No insert policy**: nobody broadcasts but the triggers. (If `private.member_topic` is not callable by the role that evaluates the policy, grant `usage` on `private` the way the existing policies on `storage.objects` reach `private` helpers; show in the PR what you needed.)
4. **Recipients:** `private.buddy_recipients(p_read uuid, p_actor uuid)`: every **joined** member of the read, **minus** members blocked either way with the actor (`private.blocked_either`), **plus** the actor's own topic (her other devices). For changes that are not about one actor (status, Sections) the blocked-pair filter does not apply.
5. **Triggers** (`security definer`, pinned `search_path`; each send is `perform realtime.send(payload, event, private.member_topic(m), true)` per recipient; **a failure to send must never fail the write**: wrap the send in a block that catches the error and raises a `warning`):
   - `after insert on buddy_messages` → **`message.new`**, payload exactly `{id, buddy_read_id, section_id, author_id, client_id, kind, body, media_url, media_width, media_height, reply_to, spoiler, created_at}`.
   - `after update of deleted_at on buddy_messages` (null → set) → **`message.deleted`** `{id, buddy_read_id, section_id}` (no body).
   - `after insert/update/delete on buddy_reactions` → **`message.reaction`** `{message_id, buddy_read_id, member_id, emoji}` with `emoji` null on delete; recipients as for the message's author pair.
   - **`buddy_read.changed`** `{buddy_read_id}` and **nothing else**, to every joined member, when: a member joins, leaves or is removed or `role` changes (`buddy_read_members`), a member's **`read_through` changes** (the generated column; compare old and new in the trigger), the Sections change (statement-level on `buddy_read_sections`), `buddy_reads.status` changes. **No page, percent, fraction, `read_through`, `hand_through`, `auto_through`, entry id or section number in any payload**: the client reads the new Section through `buddy_read()`.
   - **`buddy.invitation`** `{buddy_read_id}` to the invitee only, when a `buddy_read_members` row is inserted with `joined_at is null`.
   - An account deletion or a deleted read cascades many rows: the triggers must stay cheap and must not raise when the read or the member is already gone.
6. `pnpm schema:snapshot` and commit it. **Note for the PR description:** the snapshot does not cover policies on `realtime.messages` (`supabase/schema-snapshot/README.md`, "Left out on purpose"), so the pgTAP file is the only guard of the policy.

## Not in it

The client (W2: the lazy `#realtime-client` door, `liveChannel` from the package). Any change to D1–D3's function bodies other than adding triggers. The hosted dashboard setting itself (owner action O3; state it, do not do it). Push. The import job's feed.

## Constraints

- **Private channels only**: events are sent with `private := true`; the policy is the only way to listen. Do not enable or rely on public channels.
- **Whole row only in `message.new`**: the veil is the app's (Q8); everything else carries ids, never words and never numbers about reading.
- No `insert` policy, no grant on `realtime.messages` beyond the policy; do not touch the `supabase_realtime` publication (the import job's `postgres_changes` stays as it is: `supabase/schema-snapshot/realtime/publication.sql`).
- One send per recipient: at most 11 other members + the actor's own topic per event (cap 12): note the Free-plan arithmetic (12 Realtime messages per post) in the header.

## Ownership

You own: `supabase/migrations/20261113040000_buddy_read_realtime.sql`, `supabase/tests/buddy_realtime_test.sql`, `supabase/schema-snapshot/**`, and **one short "Realtime" paragraph in `docs/OPERATIONS.md`** (the topic shape, the policy, the dashboard setting, what to watch: messages a month, concurrent connections). Do not touch anything else in `docs/**`, `web/**`, or other migrations.

## Tests (run in the PR's `check` job: `supabase test db`)

`supabase/tests/buddy_realtime_test.sql`, self-contained (helpers as in D1's file; the topic helper `tests.may_join(topic)` as in Trappist's `realtime_test.sql`). Plan 4.5 items 46–51, each named: she can read only **her own** topic's rows and not another member's; no one can insert into `realtime.messages`; a post reaches each joined member (and the author's own topic) and **not** a stranger, a left or removed member, an invitee, nor a member blocked either way with the author; `message.deleted` has no body; `message.reaction` carries `emoji: null` on removal; `buddy_read.changed` on join/leave/remove/status/Sections and on a `read_through` change (by `set_buddy_hand` **and**, if D2 is in the base, by progress) and its payload is **exactly** `{buddy_read_id}`; `buddy.invitation` only to the invitee; **no payload of any event contains the keys** `read_through`, `hand_through`, `auto_through`, `entry_id`, `progress`, `page`, `percent`, `fraction`; a failing send (simulate by making `realtime.send` raise in the test's savepoint if possible; else state the limit) does not fail `post_buddy_message`. Run the **whole** suite: D1, D3 (and D2) files stay green. Vitest here: none (W2's `tests/buddy-live.test.ts` does the round trip through the real Realtime server and closes the loop for this PR; note that in the description). No Playwright, no Deno.

## Observable acceptance

- `supabase test db` green (the known local-stack `cover_store_test.sql` failure aside); snapshot committed; CI's snapshot check green.
- On the local stack, with two members of one read: member B, subscribed with a supabase-js client to the **private** channel `member:<B>` (`client.channel('member:<B>', { config: { private: true } })`, token set), receives `message.new` within seconds after A calls `post_buddy_message`, and **cannot** subscribe to `member:<A>` (refused). Paste the two console results in the PR (a throwaway script, not committed).
- The PR description names, for the owner: O3 (hosted Realtime → turn off "Allow public access" before the first release; the exact wording of that setting is from memory and was not checked), and says the import job's live feed must be re-checked on a scratch project with that setting off.
