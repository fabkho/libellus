# Migration review: `set_read_total` (20261120020000, PR #575)

## 1. Verdict: safe to release.

## 2. Findings (each with `file:line`, production effect, and whether sound)

Review sources (on `origin/main`): `supabase/migrations/20261120020000_set_read_total.sql`,
`supabase/tests/set_read_total_test.sql` (checked the actual file, not the brief's excerpt),
`supabase/migrations/20261114010000_progress_day_edit.sql` (the `sync_write` body this replaces),
`supabase/migrations/20261004074435_progress_page_count_override.sql` (the `update_progress` sibling),
plus the call chain `web/app/data/queuedWrites.ts` / `web/app/data/library.ts` and
`web/app/data/progress.ts` `ownTotal`.

### Authorization — checked and sound

- `20261120020000_set_read_total.sql:44-46` — null-uid guard raises `not_signed_in` (42501)
  before anything else. A caller with no JWT gets a refusal, not a silent act-as-nobody.
  Sound.
- `:54` — ownership guard `e.member_id = v_member` where `v_member := auth.uid()`.
  A member's entry id for another member's entry matches nothing → `entry_not_found`
  (P0002) at `:57-59`. Deliberately indistinguishable from "entry does not exist",
  same as the siblings. Sound.
- `:35` `security definer` + `:36` `set search_path = ''`: every object reference in
  the body is schema-qualified (`auth.uid()`, `public.library_entries`, `public.books`),
  so a hostile caller `search_path` cannot redirect an unqualified name. Sound.
- `:70-71` — `revoke all ... from public, anon; grant execute ... to authenticated`.
  `anon` cannot call it; only a signed-in member can. Correct: the function needs
  `auth.uid()` anyway, and per-row ownership is enforced inside. Sound.
- `:56` — `for update of e` locks exactly the caller's own entry row
  (the only row the `where` can match). No second lock is taken (no session row,
  unlike `update_progress` at `20261004074435:91-92`, which also locks a session):
  lock ordering against `update_progress` is entry-row-first on both sides, and two
  concurrent `set_read_total` calls on the same entry serialize on the same row lock
  rather than deadlocking. Sound. (Residual risk is only lock *waiting* under heavy
  same-entry contention, which is the intended serialization: "another device lands
  one after the other".)

### The write itself — checked and sound

- `:64` — `update public.library_entries set page_count_override = v_override where
  id = p_entry_id` touches exactly one column. `books.page_count` (the shared Catalogue
  row) is only ever *read* (`:51-55`); it is never written. The owner's "only her own
  override" rule holds. Sound.
- `:62` — `is not distinct from` collapse: null-vs-null → `null` (stored as no override,
  correct); null-vs-N → stores N (correct: a book with no edition count gets her total);
  N-vs-same-N → `null` (correct: mirrors client `ownTotal` at
  `web/app/data/progress.ts:112`, `total === editionCount ? null : total`, and the
  sibling `update_progress` at `20261004074435` which uses the identical expression).
  Sound.
- `:47-49` — range `1..99999` with `progress_invalid` (22023), byte-identical shape to
  `update_progress` (`20261004074435:98-99`: `p_page_count not between 1 and 99999`).
  `0` and negatives refused before any read. Sound. Belt-and-braces: the schema also
  carries `library_entries_page_count_override_range check (... between 1 and 99999)`
  (`20261004074435:44`), so even a bypassing writer cannot persist an out-of-range value.
- `:29-32, :39-41` — `p_entry_id` null: the guarded `select ... where e.id = p_entry_id`
  matches nothing (`= null` is never true) → `not found` → `entry_not_found`, no update
  runs. Sound. (`p_page_count` null is the documented "clear back to the edition's" path.)
- Surrounding statements: nothing runs at migration-apply time (two `create`/`create or
  replace` + grants only); the write happens only when a member calls the function.
  Each `create or replace` is a single atomic DDL statement — no halfway state, no
  half-applied migration. Additive only, no row touched at apply. Sound.

### The `sync_write` branch — one cosmetic plus one cosmetic-drift note, both harmless

- `:80-271` re-declares the whole `sync_write`. I extracted the body from this migration
  and from `20261114010000` (lines 404–589, which is the full function plus trailing blank)
  and diffed them: **ignoring blank lines, the ONLY change is the new `when 'set_read_total'`
  clause** (`:255-262`), placed immediately before `else raise action_invalid`, passing
  `p_entry_id` and `p_page_count` by the same names the client queues
  (`web/app/data/library.ts:1017` `args = { p_entry_id, p_page_count }`).
  Sound — argument names match on all three sides (client, branch, function).
- Cosmetic drift, no behaviour change: (a) the old body ends `end;\n$$;` + trailing blank
  line, the new body ends `end;\n$$;` without it (`diff` shows `186d193 <` empty line);
  (b) the new migration's preamble comment (`:76-78`) has visibly collapsed spacing
  ("is the one  left, unchanged but for the new  clause") — a comment typo only.
  Neither affects execution. No fix proposed; not worth a migration.
- No intervening migration re-declares `sync_write` (grep over `20261115010000`–
  `20261120010000` and tree-wide: only `20261004202145`, `20261005102500`,
  `20261010120000`, `20261017010000`, `20261025010000`, `20261114010000`, and this one),
  so the re-declaration cannot have silently clobbered a newer fix. Sound.
- The `comment on function sync_write` and its `revoke`/`grant` pair live only in the
  older migrations (e.g. `20261114010000:590-598`) and are not repeated here — correct,
  since `create or replace` preserves existing grants/comments. Sound.
- Idempotent replay: the branch sits *after* the claim-first `synced_writes` guard
  (`insert ... on conflict do nothing`; second send with the same `request_id` returns
  the stored result with `replayed: true` without re-running the branch). A retried
  offline `set_read_total` therefore applies at most once per request id. Sound.
  (Two *different* request ids remain two intentional writes — last-writer-wins on the
  override — which is the correct semantic for "her editable number".)
- `synced_writes` has no action allowlist (checked `20261004202145_sync_write.sql:45-51`:
  `action text not null`, no check constraint), so no schema change was needed to admit
  the new action name; unknown actions fail at the `else raise action_invalid` arm.
  Queued-writes allowlist on the client already includes `'set_read_total'`
  (`queuedWrites.ts:35`), and the offline reducer mirrors the null-collapse
  (`queuedWrites.ts:262-266`). Consistent. Sound.

### Tests — all seven behaviours pinned, `plan(18)` matches

`supabase/tests/set_read_total_test.sql` declares `plan(18)` and contains exactly 18
assertion statements (`lives_ok`/`is`/`throws_ok` at test-file lines 68, 71, 74, 81,
84, 87, 93, 96, 99, 102, 105, 108, 115, 118, 126, 129, 136, 139). Count matches.
Checked and sound.
Seven behaviours, seven groups of assertions — see coverage list below.
Coverage against the brief's seven behaviours:

1. Finished entry can be set — pinned (dune finished at page 280, then
   `set_read_total(dune, 420)` lives + `page_count_override is 420` + effective-count
   `coalesce` is 420).
2. Non-null override replaced by a new value — pinned (420 → 100 → 300-as-null →
   450; each step asserted).
3. `null` clears to the edition's count — pinned (`set_read_total(dune, null)` →
   override `null`, effective `coalesce` back to 300).
4. Total equal to the edition's stored as `null` — pinned (300 → `null::integer`).
5. Sessions unchanged when total goes below logged pages — pinned
   (`reading_sessions.progress_page is 280` after setting total 100).
6. Another member cannot set it — pinned (`max_id` acting on Ida's dune →
   `entry_not_found` P0002; plus max's own entry accepts 400, proving the refusal is
   ownership, not breakage).
7. 0 and 100000 refused — pinned (`throws_ok` `progress_invalid` 22023 for both).

No fixture-is-empty false-pass: fixtures create real rows (`dune` finished via
`update_progress`+`finish_reading`, `emma` finished without a count), and assertions
read back those rows' columns. Sound.

### Production risk — checked and sound

- Nothing runs automatically at apply: DDL only, no `update`/`delete`/backfill,
  no trigger, no cron. Existing rows untouched. Sound.
- Two `create or replace`s are each atomic; failure of the second leaves the old
  `sync_write` in place (which merely lacks the new branch — the pre-existing state,
  not an inconsistency). Safe. Sound.

## 3. Direct answers to the traced questions

- **`sync_write` diff vs `20261114010000`: is the only change the new `when` clause?**
  Yes, ignoring blank lines (`diff -B` shows exactly one hunk: the 8-line
  `when 'set_read_total'` branch before `else`). The one residual diff line is a
  trailing blank line after the final `$$;` — whitespace only.
- **Idempotent replay of queued `set_read_total`?** Yes: the branch executes only on
  first claim of `request_id` in `public.synced_writes`; a duplicate send returns the
  stored result with `replayed: true` and never re-runs the update.
- **Can `auth.uid()` be null/spoofed under `security definer`?** Null → refused up
  front (`not_signed_in`). Spoofing would require forging a Supabase JWT (verified by
  PostgREST before the function runs) or the `service_role` key (never shipped to
  clients; and a service-role caller is the operator, not the threat model). All
  references are schema-qualified under `search_path = ''`. Sound.
- **Is `page_count_override` the only writable column?** Yes: the single `update`
  sets only `page_count_override`; `books.page_count` is read-only input to the
  null-collapse.
- **Do the 18 pgTAP assertions pin the seven behaviours?** Yes — all seven above are
  asserted against real fixture rows (finished reads, cross-member attempt, boundary
  refusals, history preservation). `plan(18)` matches the 18 assertion statements.

## 4. Defect, fix, urgency

No defect found. No fix proposed, no new migration needed. Nothing left open from this
review; the verdict stands as the whole of the deliverable.
