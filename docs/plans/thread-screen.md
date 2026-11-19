# One composable for both thread screens

A buddy read's Section (`pages/together/[id]/[section].vue`) and a Book's chapter of Notes (`pages/notes/[book]/[chapter].vue`) carried the
same thread pipeline twice: open/load, load-older, send/retry/discard/react/answer, the action bar, the veil, the capture-phase voice press.
The shared half now lives in `app/composables/useThreadScreen.ts`, **in this app**. Nothing moved into `@fabkho/chat` or `@fabkho/ui`, and
neither gained a dependency: the chat layer forbids words and app imports, the UI layer forbids app state in presentational components, and
trappist's chat page has no pipeline like this one.

## The seam

`useThreadScreen(adapter, opts)` returns what the two pages bound before. All that differs is asked of them:

- **the adapter** (`utils/notesThreadAdapter.ts`, `utils/buddyThreadAdapter.ts`) — one page's store, with the page's own addressing closed
  over inside it (`store.messagesOf(room, chapter)`, `threadKey(read, section)`). No thread key, room or section is named in the composable.
- **the opts** — the words, the bar's emoji, `canLike`/`canWrite`, `extraActions`, `deleteText`, `sendQuote`, the composer's test id, the
  player.

The composable never branches on product: there is no `if (isNotes)` in it.

**A note's audience never reaches it.** The notes adapter passes its `level` inside `send`/`sendVoice`, and refuses a recording at any level
other than Only me with `voice_private_only` before its store is called.

## What stays in the pages

| Notes keeps | A buddy read keeps |
| --- | --- |
| `startLevel`/`settleLevel`/`noteSendOptions`/`noteVoiceAllowed`, `level`/`sendAs`/`parentLevel`, `NotesVisibilitySheet`, the public notice | `archived` as `canWrite`/`canLike`, the `ahead`/`paused` banners, `reached` |
| the microphone gate (`voiceMaxMs` at Only me) and the `voice_private_only` refusal | `range`/`title`/`sectionTitle`, the `room` segment |
| the whole edit flow (`editing`/`editText`/`editBusy`/`editError`/`openEdit`/`cancelEdit`/`saveEdit` + the items-watcher tombstone cancel) | the Host's delete-any, passed in as an `extraActions` input |
| | `retain()`/`release()`, behind the adapter (`import('#realtime-client')` stays lazy) |

## The action bar is composed, not forked

`base(report, delete) + opts.extraActions(item)`, and `actionsOf` returns `[]` when `!canWrite()`. A bar press runs through the same guard
the bar was drawn under, so a stale press on a tombstone or a message still on its way does nothing; the page's own buttons are only its to
open (`onAction`), and a page may take `delete` for its own words (a Host's message that is not hers).

## The four commits

Each is green and shippable on its own.

1. **`feat(threads): the seam a thread screen shares, as types`** — `useThreadScreen.ts` with the types only, and `tests/thread-screen.test.ts`
   asserting the pure modules (`roomThread`, `useVoicePress`, `notes`, `noteVisibility`) are untouched.
2. **`test(threads): the two voice presses pass the same keys, pinned`** — `tests/thread-screen-voice-parity.test.ts` reads both pages'
   `useVoicePress({ … })` option keys from source and pins them identical and in order, so the parity survives the move.
3. **`feat(threads): the handlers both thread screens ran twice, once`** — send/sendVoice/retry/discard/react/answer/confirmDelete/report, plus
   `text`/`replyTo`/`notice`/`fresh`/`quoteFor`/`replyChip`/`loadOlder`/`hasMore`/`olderStatus`, behind the fake-adapter tests.
4. **`refactor(threads): one shell for a thread screen, mounted once`** — `screen.start()`: the load, the thread opening when the veil lets her
   in, the channel, back online, the document's visibility, the heading's focus and the teardown.

## Risks and how they are caught

- **`permanent` retry semantics.** `isRetryableNoteError` and `isRetryableBuddyError` have different code tables (`rate_limited` vs
  `message_rate_limited`). The composable never decides this — `adapter.retryable` is the page's own function — and `thread-screen.test.ts`
  walks **both** tables, asserting `permanent = !retryable` for every retryable and non-retryable code in each.
- **`threadKey`/`closeThread`/`retain`/`release` leaks.** Names live only in the adapters; `thread-screen.test.ts` counts
  `openThread`/`closeThread`/`retain`/`release` across a mount, a veil opening and the teardown, and the adapters' test counts them across
  `view.open` flaps.
- **Voice signing.** `useVoicePress` is untouched: the composable hands it the same eleven options, `thread-screen.test.ts` drives the
  double tap (likes, stops the player, never plays), the window, `canLike = false`, and `isOpen = false` fetching nothing; the parity test
  pins the keys both pages had.

## Verification

- `pnpm test tests/thread-screen.test.ts tests/thread-screen-adapters.test.ts tests/thread-screen-voice-parity.test.ts tests/room-thread.test.ts tests/use-voice-press.test.ts tests/buddy-thread-view.test.ts` — 97 passed.
- e2e on the built app, specs unchanged: `book-notes` 7, `notes-voice` 5, `buddy-read` 5, `buddy-voice` 2, `buddy-voice-hold` 2,
  `buddy-gestures` 1, `offline` 1 + `offline-sync` 3, `a11y` 11 — all green.
- No full typecheck, no migration, no snapshot, no i18n key, no layer pin.

## The manual phone check

Driven on the flows' iPhone 15 viewport against the local stack:

- Notes: a note sent and drawn; a send while offline left a refused bubble with "You are offline" and **Try again**, and **Delete** after it
  gave it up; the audience tab said "Send to: Only me" and "Send to: Friends"; the microphone was **absent** at Friends; "Show anyway" on a
  veiled chapter landed focus **in the composer**; at 200 % text the action bar opened with **0 px** horizontal overflow.
- A buddy read: a message sent in the room; Section 1 → Section 2 → back returned to Section 1 with nothing doubled after a wait (both
  Sections were veiled for a fresh member, as designed); a right click on her own message offered **only Delete** (no self-report); a single
  tap liked nothing.
