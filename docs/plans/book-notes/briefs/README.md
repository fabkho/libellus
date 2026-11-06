# Book notes: build briefs

The plan is [`docs/plans/book-notes.md`](../../book-notes.md) (approved; decisions in its part 8). Each brief here is
self-contained: a worker reads **its brief and the plan**, nothing else is assumed.

## Order

| # | Brief | Model | Starts | Merges |
|---|---|---|---|---|
| 0 | The plan itself (PR #518, docs only) | – | – | **first**: the coordinator drops "DO NOT MERGE", marks it ready and merges it, so the build PRs can link the plan on `main` |
| **N1** | [N1-database.md](N1-database.md): the Notes base in the database | **Opus, high** (`anthropic/claude-opus-5-5:high`) | at once | after the coordinator's independent security review |
| **N2** | [N2-notes-page.md](N2-notes-page.md): the Notes page, the chapter thread, the Book page | **Sonnet, high** (`anthropic/claude-sonnet-5-5:high`) | when N1 has pushed its migration (day 1: the function signatures in the N1 brief are the contract; N2 applies N1's migration to its own stack from N1's branch while N1 is open) | after N1, rebased on `main` |
| N3, N3c, N3b, N4 | not briefed yet (plan part 6); N3 waits for a week of N2 in use | – | – | – |

## What no brief may touch

- **Production.** Never `supabase db query --linked`, `supabase db push`, the dashboard or production secrets. Releases are the
  coordinator's.
- **The shared local stack** (ports 553xx, `project_id = "libellus"`) and other workers' stacks. Never `supabase stop --all`.
- **Applied migrations** (`supabase/migrations/*` on `main`): never edited or deleted (`AGENTS.md`); CI refuses it.
- **The buddy tables and their functions** (`buddy_*`), except the two additive changes N1 makes to `public.block()` and
  `private.can_see_photo` (named in its brief). Buddy reads are live for every member.
- **Realtime** (no new channel, policy or trigger), **storage buckets** (no voice in Notes before N4), **edge functions**.
- `stores/buddyRead.ts` internals (N3c re-bases it later), `@fabkho/ui` and `@fabkho/chat` (a change there is a release of that
  package, not part of these PRs).
- Generated files by hand: `supabase/schema-snapshot/` (run `pnpm schema:snapshot`), `web/app/assets/css/tokens.generated.css`.

## The PR shape (both briefs)

1. A **new branch off `origin/main`**: `feat/book-notes-db` (N1), `feat/book-notes-page` (N2), in a fresh Orca worktree.
2. **A private throwaway Supabase stack**, never the shared one. The recipe of `web/perf/README.md`, with a unique id and ports:
   ```sh
   STACK=/tmp/libellus-notes-n1          # N2: /tmp/libellus-notes-n2
   mkdir -p $STACK && cp -R supabase $STACK/supabase && cd $STACK
   perl -pi -e 's/5532(\d)/5581$1/; s/^project_id = "libellus"/project_id = "libellus-notes-n1"/' supabase/config.toml
   #      N2: 5582$1 and libellus-notes-n2
   supabase start -x studio,logflare,vector,imgproxy
   ```
   - After a migration change: copy `supabase/migrations/` (and `supabase/tests/`) over again and `supabase db reset` **in
     `$STACK`**; pgTAP: `supabase test db` in `$STACK`.
   - The snapshot: `SUPABASE_WORKDIR=$STACK pnpm schema:snapshot` (from `web/`; `scripts/schema-snapshot/run.mjs` reads the
     project id there).
   - Vitest (`pnpm test`) and the flows read the stack from the environment, not from the repo: export `SUPABASE_URL`,
     `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` and `MAILPIT_URL` from `supabase status -o env` run in
     `$STACK` (`web/tests/support/stack.ts` falls back to the shared stack's ports otherwise: do not let it). For the flows,
     the same variables plus what `web/e2e/build.ts` and `web/e2e/fixtures.ts` read; `web/.env` points at the same stack.
   - Stop only it: `cd $STACK && supabase stop`. A dev server, if one is needed, listens on the port the coordinator gave the
     worker (3101 unless told otherwise).
3. **One PR**, conventional title (`feat(notes): …`; release-please writes members' notes from `feat:` subjects, so write it for
   a member), body: what it does, the plan link, the decisions it implements by number, how it was tested, what it does not do.
4. **Label `full-e2e`, ready for review (not draft).**
5. **CI gate**: the checks named **`database rules (pgTAP), data layer (Vitest) and backup`**, **`tokens, web build and edge
   functions`** and every **`user flows (shard n/4)`** are SUCCESS (look them up by name: `gh pr checks <n>`; do not watch them
   blockingly, the coordinator's rule for CI). A red check is fixed in the same PR.
6. `pnpm schema:snapshot` committed with any migration; `docs/parity.md` entries for what members see; EN and DE strings.
7. **Squash, merge and the release are the coordinator's.** Report with `orca_report` when the PR is green: the PR URL, what
   was built, what was not, and anything a reviewer must look at.
