# D2 · Database: a member's Section from her reading progress

**Repo / branch:** libellus, `feat/buddy-read-position`. **Base:** `origin/feat/buddy-read-db` (D1, draft PR #473; **stacked**: create the branch from it, open the PR with base `feat/buddy-read-db` and retarget to `main` once #473 merges; rebase if D1 changes). **Tier:** normal at `high` (Sonnet 5.5, `high`). **Size:** M. **Depends on:** D1. **Independent of:** D3 (they edit disjoint objects and can run side by side).

## Task

D1 stores a member's position as `buddy_read_members.auto_through` / `hand_through` and the generated `read_through`, and shows others only a `where` Section; **nothing writes `auto_through` yet**. This PR makes it automatic: from the progress of the Library entry she linked (page, percent, finished) to the number of Sections she has completed, kept current by triggers. Read first: `docs/plans/buddy-read-shared.md` **part 5** (5.1 Sections, 5.2 the fraction and the session that counts, 5.3 the edge-case table, 5.5 what others see), D1's migration `supabase/migrations/20261113010000_buddy_reads.sql` (on the base branch: its header, `private.buddy_gate`, `private.buddy_lock_read`, `private.buddy_parts`, `private.buddy_me`, `private.buddy_where`, `link_buddy_entry`, `set_buddy_hand`, `set_buddy_sections`), `supabase/schema-snapshot/tables/public.reading_sessions.sql`, `…/public.library_entries.sql`, `web/app/data/reader/progress.ts` (`progressAt`: the reader writes a page of the page count, else a percent), `supabase/migrations/20261003122500_reading_progress.sql` (`update_progress`) and the existing tests `supabase/tests/clear_progress_test.sql`, `change_edition_test.sql`, `import_books_progress_test.sql`.

## First, on the local stack

D1's migration must be applied before you start: `supabase migration up` (from the repo root; the local stack may be older than the base branch). Run `supabase test db supabase/tests/buddy_reads_test.sql` on the base branch first: 196/196 is your baseline.

## Change

1. **Migration** `supabase/migrations/20261113020000_buddy_read_position.sql` (renumber after the latest on `origin/main`/the base if it moved; D3 takes `…030000`, D4 `…040000`; versions only need to be unique and ordered, release applies with `--include-all`). A header comment says what it does and what it leaves out, and **states the exception to social v1's promise in one paragraph**: the follower-facing functions still show no progress; `buddy_read()` shows a co-member only her Section (`where`). Do not edit the applied comment in `20261017040000_social_readers.sql`.
2. **`private.buddy_fraction(p_entry uuid, p_joined timestamptz) returns numeric`** (stable, pinned `search_path`): exactly the rule of plan 5.2: the session that counts is the entry's open session (`outcome is null`), else the latest closed one whose `coalesce(ended_on, started_on) >= p_joined::date`, else none → `null`; `finished` → 1; `progress_page` → `least(1, page / coalesce(entry.page_count_override, book.page_count))`, `null` if there is no page count; `progress_percent / 100`; a session without progress → 0.
3. **`private.buddy_refresh(p_read uuid, p_member uuid)`**: recomputes `auto_through` = number of `part` Sections with `to_fraction <= f + 0.005` (`null` when `f` is null or she has no linked entry or has not joined), writes it only when it differs. **Takes the read's advisory lock** (`private.buddy_lock_read`, lock 2 of D1's order; the progress triggers hold no buddy lock, so 2-only is order-safe) so that it serialises with `set_buddy_sections` and sees the new Sections. Plus `private.buddy_refresh_entry(p_entry uuid)` (every joined membership linked to that entry) and `private.buddy_refresh_read(p_read uuid)` (every joined member of a read).
4. **Triggers** (all `security definer`, pinned `search_path`, no `execute` for members; **none of D1's public functions is redefined**: D3 replaces some of them and the two must not collide):
   - `reading_sessions`: `after insert or update of progress_page, progress_percent, outcome, ended_on, started_on` for each row, with a `when (…)` clause that skips updates that change none of these → `buddy_refresh_entry(new.entry_id)`. Cheap when no membership is linked (one probe on `buddy_read_members(entry_id)`, partial index `buddy_read_members_entry`).
   - `library_entries`: `after update of book_id, page_count_override` → `buddy_refresh_entry(new.id)` (edition change, own total).
   - `buddy_read_members`: `after update of entry_id, joined_at` → refresh that member (link, join, accept). **`before update of entry_id`**: when an entry is unlinked or removed (`new.entry_id is null and old.entry_id is not null`; the FK `on delete set null` fires it too) set `new.hand_through := greatest(coalesce(old.hand_through, 0), old.read_through)` and `new.auto_through := null`: her Section stays where it was and nothing silently opens or closes (plan 5.3). (A generated column is not yet computed in a `before` trigger: use `old.read_through`.)
   - `buddy_read_sections`: three **statement-level** triggers (insert, update of `to_fraction, kind`, delete; transition tables cannot be shared between events) → `buddy_refresh_read` for the affected reads. This is what makes `set_buddy_sections` (replace) and `create_buddy_read` (the host's entry may already have progress) correct without touching them. `hand_through` is already clamped by D1's `set_buddy_sections`.
5. **`comment on function public.buddy_read(uuid)`** and `private.buddy_where`: what a co-member can and cannot see (plan 5.5), in two sentences.
6. `pnpm schema:snapshot` (from `web/`, stack up and migrated) and commit the regenerated `supabase/schema-snapshot/`.

## Not in it

Realtime events for a changed Section (D4: the member-row trigger there fires on `read_through` changes, whatever wrote them). Messages (D3). Any change to D1's RPC bodies, to `update_progress`, `finish_reading`, `start_reading`, `change_edition` or to any follower-facing function. Any web code, i18n, copy, README, privacy text.

## Constraints

- **Never edit an applied migration**; only add the new file. D1's migration is not applied to production yet but is on a PR: do not edit it either.
- A progress update by a member who is in **no** buddy read must change no buddy row and cost one index probe at most (prove it, below). The reader writes progress at most once a minute per member; do not add work to that path.
- No number about progress may reach another member: not from these functions, not from `buddy_read()` (page, percent, fraction, dates, outcome, entry id, hand/auto source stay out). The existing assertion in `buddy_reads_test.sql` that follower-facing functions return no progress stays green.
- `joined_at::date` is a UTC date and session dates are the member's local dates: a one-day fuzz at the boundary. Keep the rule of 5.2 as written and **document the fuzz in the migration header**; do not "fix" it silently.
- Pin `search_path` on every function; use `clock_timestamp()` where order matters.

## Ownership

You own: `supabase/migrations/20261113020000_buddy_read_position.sql`, `supabase/tests/buddy_read_position_test.sql`, `supabase/schema-snapshot/**`. Do not touch `web/**`, `docs/**`, `CONTEXT.md`, D1's files, or any other migration.

## Tests (run in the PR's `check` job: `supabase test db`)

`supabase/tests/buddy_read_position_test.sql`, self-contained (copy D1's test helpers `tests.member`, `tests.act_as`, `tests.snap`, `tests.secs` from `buddy_reads_test.sql`; drive progress through the real functions `start_reading`, `update_progress`, `finish_reading`, `abandon_reading`, `change_edition`, `remove_from_library` as the member). **One named assertion per row of the plan 5.3 table**: pages (read 400 pages, hers 380), percent, no page count anywhere (`f` null, hand works), finished (all parts and the end open), abandoned (frozen at its last progress, `ended_on` on/after joining), an older finished session (not counted: auto null), a re-read after a finish (the open session wins, her Section falls back), edition change with another page count, `page_count_override` set/cleared, entry removed or unlinked (hand frozen, auto null), no linked entry and nothing set (`where` = `not_set`), hand above auto, hand below auto, progress corrected downwards, boundary (`to_fraction 0.5000`: `f 0.4950` completes it, `0.4949` does not), the host replaces the division (everyone recomputed, hand clamped) and `create_buddy_read` for a host whose entry already has progress. Plus: a progress update by a member in **no** room changes no row (`xmin` unchanged on an unrelated `buddy_read_members` row, and no buddy row written), what a co-member reads from `buddy_read()` never contains the keys `progress`, `page`, `percent`, `fraction`, `ended_on`, `entry_id`, `hand`, `auto`, and a follower-facing function still returns no progress. Run the whole suite (`supabase test db`): `clear_progress_test`, `change_edition_test`, `import_books_progress_test` and all D1 tests stay green. Vitest, Playwright, Deno: none.

## Docs

The migration header and the `comment on function`s. No `docs/parity.md` (no screen), no privacy text (P1).

## Observable acceptance

- `supabase test db` green (the whole suite; today only `cover_store_test.sql` fails on a stale local stack, per PR #473: say so if it still does); schema snapshot committed, CI's snapshot check green.
- As a member through PostgREST: join a read with a linked entry, `update_progress` to 55 % on a 4-part read → `buddy_read(id).me.read_through = 2`, `.me.where = {kind: section, section: 3}`; the host sees the member as `{kind: section, section: 3}` and **no number**; unlink → her Section stays at 3; `finish_reading` → `{kind: end}`.
- `EXPLAIN` of the `reading_sessions` trigger path for a member in no room, pasted in the PR description: one index probe on `buddy_read_members_entry`.
- Report in the PR: anything in plan part 5 you changed and why, and the UTC-date fuzz.
