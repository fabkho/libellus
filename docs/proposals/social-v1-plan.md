# Social version 1: the execution plan

How [social-v1.md](social-v1.md) gets built: the tasks, which model does each, in what order, and how
each is checked. Written before any worker starts; the coordinator reads it first.

## Roles

| Who | Does |
|---|---|
| **Social orchestrator** (the worker in the `social-proposal` worktree, Opus 5.5) | Writes the contract and the database tests, spawns and briefs the workers, reviews and merges each task into `feat/social-v1`, runs the gates, opens the final pull request. Merges nothing into `main`. |
| **Orca coordinator** | Owns `main` and releases. Gets a `status` message at every gate below and the final pull request. Decides when `feat/social-v1` goes into `main` and when it is released. |
| **Owner** | Sees the contract before workers start (gate 0) and the final pull request. |

## Ground rules

- **One branch for the feature.** `feat/social-v1` (off `main` at release 1.5.1). Every task branches off
  it and is merged back into it by the orchestrator, locally, after its checks. A draft pull request
  `feat/social-v1 → main` stays open from the first merged task, so each push runs CI's pgTAP, Vitest and
  build jobs (pull requests run no user flows). The feature reaches `main` in one go.
- **Models**, by `~/.pi/agent/AGENTS.md`: Opus 5.5 only for the orchestrator (contract, reviews,
  debugging), never more than one Opus at a time; **Sonnet 5.5 at `high`** for every implementation
  task; **Haiku 5.5** for mechanical tasks with an exact spec. A task that fails its checks twice goes to
  an Opus debugger, not a third Sonnet attempt. At most **three workers at once**.
- **Contract first, tests first.** Every database function's signature, JSON answer and refusal codes,
  every table, type, route, test id and string are fixed in the contract (step 0) before anyone codes;
  the pgTAP tests of steps 1–4 exist before the database tasks start, so a database task is "make these
  tests pass, change none of them without asking".
- **A database of our own.** The local stack (`project_id = "libellus"`, ports 55320–55329) is shared by
  every Libellus worktree on this machine, the coordinator's other workers included, and a
  `supabase db reset` in one wipes the others. The social work runs on its **own stack**: a copy of
  `supabase/` with `project_id = "libellus-social"` and ports **55620–55629**, started and reset only by
  the orchestrator or the one database task holding it. The suites already read their stack from the
  environment (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `MAILPIT_URL`;
  `web/tests/support/stack.ts`), so a worker's brief exports those four. The real stack is never touched.
- **The database tasks run one after another** on that stack (each needs the one before, and only one
  may reset it). From gate 1 on, the stack runs `feat/social-v1`'s migrations and nobody resets it;
  Vitest and Playwright tag their data per run, so parallel runs do not clean up each other's.
- **Each task owns its files**, listed in its brief; anything else is a question to the orchestrator.
  `web/i18n/locales/en.json` is written once (W4) for every new string; a task that still needs one adds
  it under its own key prefix and names it in its report. `docs/parity.md`, SPEC.md, CONTEXT.md and
  README.md are written once at the end (E2) from the tasks' reports.
- **Tests: critical paths only end to end** (owner, 8 October 2026). Rules in pgTAP, logic in Vitest,
  one Playwright flow for the whole loop (E1), one accessibility scan of the new screens in one theme,
  `@full`. No screen task writes its own Playwright flow.
- **Each worker gets a port** from Orca (3100–3999) for `pnpm dev` and `LIBELLUS_E2E_PORT`.
- **Commits** are conventional, one concern each, a body saying why; `CHANGELOG.md` is never edited;
  no full typecheck, the targeted tests instead (web/AGENTS.md).

## Before the social work: the test-suite audit (separate, into `main`)

Runs alongside step 0; touches no database. One pull request into `main`, merged by the coordinator.

| # | Task | Model | Done when |
|---|---|---|---|
| T1 | **Rewrite the test rules**: `web/AGENTS.md` ("Definition of done … 3. A Playwright flow", "a new screen or sheet gets an `expectAccessible` scan … both themes"), `CONTRIBUTING.md`, `docs/TESTING.md`: end-to-end only for the critical paths (sign up and in; search → add → start → finish; offline sync; the reading page and waitlist; deleting the account; and, once it lands, the social loop), everything else in Vitest or pgTAP, accessibility in one theme. | Sonnet | The three files say the same rule; nothing else changes. |
| T2 | **Cut the suite** by that rule: every spec ranked by its seconds in `web/e2e/durations.json` (243 flows, about 2,126 s) against what a regression would cost. Remove what is not critical, or move its check down into a Vitest test where it is logic (`library-filters`, `install-hint`, `share`, …). The accessibility specs (`a11y.spec.ts`, `a11y-reader.spec.ts`, about 370 s) go to one theme. Borderline cuts are listed, not made. | Sonnet | The pull request lists every removed flow with its seconds, the before and after total, the borderline list for the owner; the remaining suite passes once on the `full-e2e` label. |

The orchestrator checks T2's list flow by flow before it is opened.

## Step 0: the contract (orchestrator)

| # | Task | Model | Output |
|---|---|---|---|
| 0.1 | **The contract**, `docs/proposals/social-v1-contract.md`: the migration's DDL; every RPC with its arguments, its JSON answer (exact keys), its refusals (codes and SQLSTATEs) and who may call it; the TypeScript types the repositories return; the routes; every `data-testid`; every `en.json` key with its English; the shape of the one Playwright flow; the parity outline. | Opus (orchestrator) | One file, reviewed by a Sonnet reviewer for gaps against social-v1.md |
| 0.2 | **The database tests first**: `supabase/tests/social_*_test.sql` for D1–D4, acting as four members (private, public, follower, stranger), red until the tasks land. | Opus (orchestrator) | The test files, failing for the right reason |
| 0.3 | The social stack set up (`scripts/social-stack.sh`, not committed to `main`) | Opus (orchestrator) | The stack on 556xx with the branch's migrations |

**Gate 0**: the owner and the coordinator get the contract (a status message with its path). Workers
start after their go.

## Step 1: the database (one at a time, on the social stack)

| # | Task | Model | Needs | Files | Checks |
|---|---|---|---|---|---|
| D1 | Tables and their RLS: `social_settings` (private by default, the seven switches, the follow token), `follows` (`accepted_at` null = a request), `blocks`, `library_entries.hidden`; `set_private`, `set_social_sections`, `renew_follow_link`, `set_entry_hidden` (+ in `sync_write`) | Sonnet | 0.2 | one migration | `social_settings_test.sql` green; the whole pgTAP suite green |
| D2 | Following: `follow_target(token)`, `follow`, `withdraw_request`, `answer_request`, `unfollow`, `remove_follower`, `block`, `unblock`, the limits, going public accepting the waiting requests | Sonnet | D1 | one migration | `social_follow_test.sql` green; the whole pgTAP suite green |
| D3 | The activity: the `activity` table, the triggers on `reading_sessions` and the deferred one on `library_entries`, the 10-minute window and its replacing, the quiet flag in `import_books` / `import_book_for`, the 14-day rule, `purge_activity` on pg_cron | Sonnet | D1 | one migration | `social_activity_test.sql` green; the whole pgTAP suite; **the existing import and sync tests**: `import_books*_test.sql`, `sync_write_test.sql`, `web/tests/{goodreads,hardcover,fable}-import.test.ts`, `outbox.test.ts`, `offline.test.ts`; an import of 600 books makes no activity and takes about as long as on `main` |
| D4 | The readers: `feed`, `member_profile`, `member_reading_record` (rows in `SESSION_COLUMNS`' shape), the avatars select policy for followers and public accounts | Sonnet | D2, D3 | one migration | `social_read_test.sql` green; the whole pgTAP suite green |

**Gate 1** (orchestrator, Opus): the whole pgTAP suite; a Sonnet reviewer on the four migrations for
leaks (definer functions, grants, `search_path`, what a stranger can call); the orchestrator's own probe
as a stranger and a blocked member against every function and table. Then the database is frozen:
a later change to it is a new task, not an edit inside a screen task. Status to the coordinator.

## Step 2: the data layer (in parallel)

| # | Task | Model | Needs | Files | Checks |
|---|---|---|---|---|---|
| W1 | `data/social.ts`: settings, follow link, following, requests, people lists; offline refusals (`offline`) like every write | Sonnet | Gate 1 | `app/data/social.ts`, `tests/social.test.ts` | its Vitest file on the social stack |
| W2 | `data/feed.ts`: the feed repository, grouping by day, folding batches (pure functions), the device's copy and its 7-day limit | Sonnet | Gate 1 | `app/data/feed.ts`, `tests/feed.test.ts` | its Vitest file |
| W3 | `data/memberStats.ts` over `member_reading_record`, reusing `readsFromRows` and `figuresOf` unchanged (a test proves her figures equal what `figuresOf` gives on the same rows); *Hide from followers* in the outbox (`queuedWrites.ts`, the sync sheet's label) | Sonnet | Gate 1 | `app/data/memberStats.ts`, `app/data/queuedWrites.ts`, tests | its Vitest files; `outbox.test.ts` |
| W4 | Every new string in `en.json` from the contract; the five texts that change (`photo.private`, `manual.private`, `ownEdition.private`, `profile.deleteAccount.text`, `sharing.about`) | Haiku | 0.1 | `web/i18n/locales/en.json` | the keys equal the contract's list |
| W5 | The error log names `/friends/[member]`, never the id (`useErrorLog.ts` / `scrubRoute`) | Haiku | — | `app/composables/useErrorLog.ts`, `app/data/errorLog.ts`, its test | its Vitest test |

## Step 3: the screens (in parallel, three at a time)

Each builds its screens from the mocks (`social/v1-*.png`, `social/mock.html`) and the design rules
(tokens only, `UiSheet`, `UiRow`, light and dark from the same tokens), with the test ids and keys of
the contract. No Playwright flow of its own (E1 covers the loop); Vitest where it adds logic.

| # | Task | Model | Needs | Owns | Mocks |
|---|---|---|---|---|---|
| U1 | Profile → *Friends* section, the *Privacy* sheet, the follow link sheet, the *Blocked* list; `stores/social.ts` | Sonnet | W1, W4 | `components/profile/Friends.vue`, `components/friends/{PrivacySheet,LinkSheet,BlockedSheet}.vue`, `stores/social.ts`, the section's place in `pages/profile/index.vue` | 13–15 |
| U2 | `/f/<token>`: resolving the link; the private card (*Ask to follow*, *Requested*), *Follow* on a public one, a dead link | Sonnet | W1, U1 (store) | `pages/f/[token].vue`, `components/friends/Gate.vue` | 8, 9 |
| U3 | `/friends/people`: Following, Followers, Requests, *Follow back*, a member's ⋯ sheet and the block confirmation | Sonnet | W1, U1 | `pages/friends/people.vue`, `components/friends/{PersonRow,RequestRow,MemberSheet}.vue` | 10–12 |
| U4 | A member's profile and year in review on the Profile's blocks; `Hero` taking a member; your own Profile unchanged | Sonnet | W3, U2 (gate) | `pages/friends/[member]/{index,[year]}.vue`, `stores/memberStats.ts`, `components/profile/Hero.vue` (the member props only) | 5–7 |
| U5 | The feed: `FeedRow`, `FeedBatch`, the batch sheet, `/friends` with its empty states and offline line; then Home's *Your circle* with the request row and *Show more* | Sonnet | W2, W4 | `pages/friends/index.vue`, `components/friends/{FeedRow,FeedBatch,BatchSheet}.vue`, `components/home/Circle.vue`, `stores/feed.ts`, Circle's place in `pages/index.vue` | 1–4 |
| U6 | *Hide from followers* in a Book's ⋯ sheet; the lamp dot on the header's avatar while a request waits | Haiku | W3, U1 | `components/book/OptionsSheet.vue` (one row), `components/shell/Header.vue` (the dot) | 16, 1 |
| U7 | Other members' photos: download through the new policy, keep them on the device like her own | Sonnet | Gate 1 | `app/data/avatar.ts` (a member's photo), `stores/avatar.ts`, `components/ui/Avatar.vue` (a `member` prop) | — |

**Order:** U1, U5 and U7 first (no screen needs them); then U2, U3 and U4; U6 whenever a slot is free.
The existing flows that cover pages these tasks touch run before their merge: `profile.spec.ts` (U4,
U1), `home.spec.ts` (U5), `avatar.spec.ts` (U7).

## Step 4: finishing

| # | Task | Model | Needs | Checks |
|---|---|---|---|---|
| E1 | `web/e2e/friends.spec.ts`: the one flow, two members: Ida's link → Anna asks → Ida accepts → Ida finishes a Book → after the window (shortened for tests by the contract's setting) it is in Anna's feed and on Ida's profile → Ida hides it → gone → Ida blocks Anna → Anna sees nothing. Plus the new screens in `a11y.spec.ts`, one theme, `@full`. | Sonnet | U1–U7 | green on its own port, twice in a row |
| E2 | The docs: parity entries from the tasks' reports; SPEC.md (non-goals, decisions, data model, screens, privacy), CONTEXT.md (the new words, Manual book), README's intro and *What it does* | Haiku | U1–U7 | every route and screen of social-v1.md has its parity entry |

**Gate 2** (orchestrator, Opus):

1. The whole pgTAP suite, the whole Vitest suite, and every Playwright flow once on the social stack
   (the existing ones too: the triggers sit under every read and finish).
2. Four Sonnet reviewers, one concern each: privacy (a definer function or policy that says more than
   the contract), offline (what queues, what refuses), copy and accessibility, design against the
   mocks. For the design pass the orchestrator screenshots the real screens in both themes and opens
   them in Orca beside the mocks.
3. The stranger probe of gate 1 again, on the finished branch.
4. The draft pull request `feat/social-v1 → main` made ready, with the `full-e2e` label, and handed to
   the coordinator with a status message: what is in it, the test evidence, what to watch at release
   (the migration adds triggers to `reading_sessions` and `library_entries`).

## Each worker's brief

Every brief is self-contained and has the same parts:

1. **Goal** in two sentences, with its line in social-v1.md and its mocks.
2. **Contract excerpt**: the exact signatures, JSON keys, types, test ids and keys it implements.
3. **Files it owns** and files it must not touch.
4. **Environment**: base branch `feat/social-v1`; its port; the social stack's four variables; "never
   run `supabase db reset`, `supabase migration` or `supabase stop`" (step 1's holder excepted).
5. **Done when**: the tests to run and that must pass, and nothing outside the files changed.
6. **Report**: `worker_done` with the commits, the test commands and their results, any key or
   question it added, and its parity paragraph (screens only).

## Size

The orchestrator's own work (0.1–0.3 and the three gates) plus 20 worker tasks: 2 audit, 4 database,
5 data layer, 7 screens, 2 finishing; 16 on Sonnet, 4 on Haiku. Never more than three at once.
