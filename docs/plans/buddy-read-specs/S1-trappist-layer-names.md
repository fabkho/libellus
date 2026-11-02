# S1 · Trappist: the chat layer's own names, and the Trappist parts out

**Repo / branch:** **trappist** (private; the owner's other app), `refactor/chat-layer-names` off Trappist's `origin/main`, opened as a **DRAFT pull request**. **Nothing in Trappist merges without the owner's review.** **Tier:** normal. **Size:** M. **Depends on:** nothing. Work in a worktree of Trappist, not in the owner's checkout.

## Task

Prepare `web/layers/chat/` to leave Trappist as the public package `fabkho/chat` (the owner's decision, plan `docs/plans/buddy-read-shared.md` in the libellus repo, part 3, S1–S5). This PR is the first of a stack (S1 → S2 → S3): it changes **names and placement only, no behaviour**. Read first (in Trappist): `docs/plans/groups.md` section "Port to BetterReads", `web/layers/chat/app/types/adapter.ts`, `web/tests/chat-layer.test.ts` (the guard), `web/AGENTS.md` and `AGENTS.md` (the layer's rules), `docs/CI.md` (no new e2e).

## Change

1. In `web/layers/chat/app/**`, rename the field **`chapterId` → `threadId`**: `ChatRecord`, `SendJob`, the `ChatAdapter.page` / `markRead` query objects, `threadKey(conversation, thread)` and its callers in `thread.ts`, `composables/useThread.ts`, and anywhere `veil.ts`/`useBuddyRead.ts` take a chapter *id*. **Keep** the type names `BuddyChapter`, `BuddyReadData`, `ChapterPlan`, `BuddyReadAdapter`, and the functions `chapterOpen`, `chapterView`, `markerFor`, `offersMarker`: a chapter is a Section in Libellus; the layer has no words. Update the layer's file comments accordingly (one sentence: "a thread is a chapter of a buddy read, a Section in another app").
2. Map at the boundary, so the app is unchanged: the database column `chapter_id` and the app's `Message.chapterId` stay. Adapt `web/app/data/chat.ts` (`toMessage`, the job → `SendJob` mapping), `web/app/data/buddyReads.ts`, `web/app/stores/chat.ts` and `web/app/stores/buddyRead.ts` where they build or read the layer's `ChatRecord`/`SendJob`/`threadKey`.
3. Move `web/layers/chat/app/utils/inviteState.ts` and `web/tests/chat-layer-invite-state.test.ts` **out of the layer** into the app: `web/app/components/feed/inviteState.ts` (its only users are `app/components/feed/FeedBookChat.vue` and `app/components/feed/callChat.ts`), the test imported through `~/components/feed/inviteState`. The `InviteAdapter` interface in `adapter.ts` stays.
4. Update the guard `web/tests/chat-layer.test.ts` (the expected file list) and `docs/plans/groups.md` "Port to BetterReads" (the renamed field, the moved module; one paragraph).

## Not in it

Any behaviour change. The Realtime core, photo, KLIPY, error codes (S2, S3). Renaming the database column or `Message.chapterId`. Any change to `@fabkho/ui`. Any new test beyond adapting existing ones.

## Constraints

- Follow Trappist's own conventions (conventional commit title `refactor(chat): the layer's own names, and the Trappist parts out`, its `AGENTS.md`, `web/AGENTS.md`). Open the PR as a **draft**; do not merge; do not push to `main`.
- The layer must still pass its own guard: imports only itself, `vue`, `#layers/ui/…`/`@fabkho/ui/pure/…`; no `~/`, no Pinia, no Supabase, no auto-imports, no Trappist domain word (`web/tests/chat-layer.test.ts` `DOMAIN_WORDS`).
- No full typecheck (`nuxi typecheck`, `tsc --noEmit`). Use targeted checks.
- Do not edit `@fabkho/ui`, Regal, or the libellus repo.
- Later PRs stack on this branch; keep the diff mechanical so the owner can review it in one sitting.

## Ownership

You own `web/layers/chat/**`, the Trappist files that import it (listed in step 2 and `app/components/feed/*` for the moved module), `web/tests/chat-layer*.test.ts`, `docs/plans/groups.md`. Nothing else.

## Tests

Vitest (plain Node and component projects), from `web/`: `pnpm test:unit` (= `vitest run --project unit --project components`). These must stay green **unchanged except for the renamed field**: the seven `tests/chat-layer*.test.ts` files (1,348 lines), `tests/chat-store-groups.test.ts`, `tests/chat-store-buddy.test.ts`, `tests/chat-groups.test.ts`, `tests/buddy-reads.test.ts`, `tests/groups-data.test.ts`, `tests/chat.test.ts`. The stack-backed project (`pnpm test:stack`) runs in Trappist's CI; run it locally if the Supabase stack is up. No pgTAP, no Playwright.

## Observable acceptance

- `grep -rn "chapterId" web/layers/chat` prints nothing; `grep -rn "inviteState" web/layers` prints nothing.
- All listed suites pass; `pnpm --dir web build` completes.
- A chapter comment still arrives in its own thread and a group message in the group chat (the store tests prove it: they send through the queue and receive by `clientId`).
- The PR description lists every file where the boundary mapping lives, so the owner can see the rename stops there.
