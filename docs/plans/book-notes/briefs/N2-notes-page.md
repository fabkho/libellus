# N2: the Notes page, the chapter thread and the Book page

**Read first:** the plan [`docs/plans/book-notes.md`](../../book-notes.md), parts 2.2–2.5 (chapters, the three levels,
replies, changing a level, the switch, defaults, her chapter and the veil), 4 (privacy and the notice text), 5 and 5.1 (the
screens, words, moderation) and 8 (decisions). The mock-ups are `docs/prototypes/book-notes/*.html` (open them in a browser;
shots in `docs/images/book-notes/`). The database contract is the table *Public functions* in
[N1-database.md](N1-database.md): build against those names and shapes. The PR shape, the throwaway stack and what must not be
touched: [README.md](README.md). Model: Sonnet, high.

## Goal

Members can open **Notes** on a Book, set its number of chapters when nobody has, read and write notes per chapter at one of
three levels (Only me, Friends, Everyone), change a note's level later, react, reply, report and block from a note, and find
their friends' and public notes from the Book page. The owner can remove a reported note. Buddy reads behave exactly as before.

## Rules of the house that apply here

`web/AGENTS.md` in full, notably: Page → Pinia store → framework-free repository (`app/data/`) → Supabase; components of the UI
base (`@fabkho/ui`, Storybook https://fabkho.github.io/ui/) before writing one; nothing replaces a base component; every string a
key in `web/i18n/locales/en.json` **and** `de.json` (informal *du*, natural German, up to half as long again); 44 px targets;
Reduce Motion; `docs/DESIGN.md` tokens only; a link to a Book page flies its cover (`flightOf`). No full typecheck runs unless
asked; targeted checks.

## Screens

1. **Book page** (`app/pages/book/[key].vue`, around `<TogetherBookRow>`):
   - **Notes** and **Read together** side by side, two quiet half-width buttons under the Book's main action (mock-up 1).
     `TogetherBookRow` keeps its own logic, test ids (`book.together.*`) and the lines under it (full width); only its button
     moves into the pair. A Manual book: Notes disabled with one line why (as *Read together* does).
   - **The *Notes* section** (`components/notes/BookSection.vue`, below the actions): from `notes_summary(book)`; row **From
     friends** (up to 3 faces, "Ben and Jo · 14 notes · chapters 1–9"; with more authors "Ben, Jo and 3 others") and row
     **Public** (a globe, "6 notes from 3 members"), each a link to the Notes page; a row is absent when its count is 0, the
     section when both are. Read when the page opens (fresh, like `my_buddy_reads()`); no Realtime, no chat layer on the Book
     page (extend `tests/buddy-read-entry.test.ts`'s rule to notes).
2. **Notes page** `app/pages/notes/[book]/index.vue` (`[book]` = the Book id the page was opened from; the room is found by
   its Work):
   - no chapters yet (`room: null`): "How many chapters does this book have?", a number field with − and + (1–300, default
     empty, the keyboard numeric), **Make N chapters**, the footnote that the list is shared and can grow, "count prologue and
     epilogue too" (mock-up 2). `chapters_already_set` → just show the list it returns. A member without the Book
     (`canWrite: false`): no prompt; "No chapters yet." and the Book's *Add to Library*.
   - chapters (mock-up 3): hero (cover, eyebrow "Notes", title, "Yours, your friends' and public · 43 chapters"); "You're on
     chapter 5 · **Change**" (a sheet she opens herself: Automatic, Chapter 1…N, I've finished; reuse the radio pattern of
     `components/together/MarkerSheet.vue`, do not change that file); the rows as `UiThreadRow`s in a `UiRowGroup`, the room
     screen's rules for veiled rows (number, count, "hidden", no title, no faces, no dot; accessible name as in
     `pages/together/[id]/index.vue`); ⋯ with **Add chapters** and **Remove empty chapters** (a number, then the call).
   - a Book hidden from followers: one line under the hero (plan part 4).
3. **A chapter** `app/pages/notes/[book]/[chapter].vue` (mock-ups 4 and 4b): the buddy thread's screen built from the same
   base components (`UiChatThread`, `UiBubble`, `UiComposer`, `UiReactionBar`, `UiComposerChip`), immersive, focus to the heading
   (`useFocusHeading`), day separators, runs by author (`sameAuthorRun` rule):
   - **marks**: a globe and "Everyone" in the bubble's `sender` slot of a public note (others' and hers); a lock and "Only me"
     in the `meta` slot of her private note; nothing for Friends. With the switch off, her public note shows "Everyone ·
     paused" in its action bar only.
   - **the three-way control** in `UiComposer`'s `actions` slot, beside the *Spoiler* chip: the base's `UiSegmented` or
     `UiIconSegments` (check Storybook) with icons (lock, people, globe) and a word, `role="radiogroup"`, `aria-checked`, 44 px
     hit areas, fits 360 px in German (*Nur ich · Freunde · Alle*). Without the switch: two segments.
   - **defaults** (`utils/noteVisibility.ts`, pure, unit-tested): new note → the device's remembered level
     (`libellus.notes.visibility`, `private` or `friends`, default `friends`; the `libellus.` prefix so sign-out clears it);
     choosing Everyone is for one note: after send the control returns to the remembered level; a reply starts at the narrower of
     the parent's level and the remembered level; while a reply is quoted, wider levels are disabled with "Can't be wider than the
     note you answer."
   - **the line under Everyone** while it is selected: "Visible to all members of BetterReads, with your name and photo. Just this
     note." (mock-up 4b). No sheet, no dialog.
   - **quotes**: `{"hidden": true}` → "A note you can't see", `{"removed": true}` → "Note removed"; never words.
   - **the action bar** (`UiReactionBar`: six emoji, Reply, Copy, then): on her note **Who can see this** (a small sheet she opens:
     the three levels, the current checked; picking Everyone shows the same line and **Make visible to everyone**; narrowing
     applies at once), **Delete**; on others' notes **Report** (move `components/together/ReportSheet.vue` to
     `components/room/ReportSheet.vue` with a `send` prop, buddy keeps using it) and **Block {name}** (the existing `block()`
     data call and its confirm wording from People).
   - **tombstones**: "Note removed" (hers or another's) and "Removed by the moderator".
   - **the veil**: a chapter not open to her shows the veiled state with **Show anyway** (move `components/together/ShowAnyway.vue`
     to `components/room/ShowAnyway.vue`; peeks kept on the device per member and room, like `createPeeks`); nothing of a veiled
     chapter is asked from the server before yes; a *Spoiler* note veiled until tapped (own excepted).
   - **sending**: the chat layer's send queue with a notes adapter (`@fabkho/chat`'s `ChatAdapter`; see how `data/buddyReads.ts`
     provides the buddy one), idempotent `client_id`, failed bubbles with **Try again** / **Delete** as in the buddy thread.
   - **reading**: on open, when the app comes back to the front, and on a Refresh; pages of 50 back in time; `mark_notes_read`
     while she looks. **No Realtime**: the notes route must not load the Realtime client (assert it like
     `tests/buddy-read-entry.test.ts`).
4. **The owner's Feedback inbox** (`app/pages/profile/feedback.vue`): a report whose context carries a `note` gets **Remove note**
   (a `UiConfirm` with a reason field, then `owner_remove_note`), and shows the note's level from the context.
5. **Privacy notice** (`app/legal/privacy.ts`, EN and DE, the version line) and `docs/legal-checklist.md`: exactly the texts and
   additions of plan part 4.

## Data and state

- `app/data/notes.ts`: one function per RPC of the N1 contract, typed results, errors mapped to codes (no words), like
  `data/buddyReads.ts`.
- `app/stores/notes.ts`: the Notes page and threads (load, page, send, react, delete, set level, report, peeks, marks read).
  Leave `stores/buddyRead.ts` alone (N3c merges them later).
- `app/utils/noteVisibility.ts` (levels, order, clamp, defaults, memory) and `app/utils/roomThread.ts` (the parts of
  `utils/buddyThread.ts` both threads use: veil, items, runs; `buddyThread.ts` re-exports them unchanged so buddy code and
  `tests/buddy-thread-view.test.ts` do not move).
- `notes_config()` read once a session and when the app comes back to the front.

## Words (keys `notes.*`, EN / DE)

Notes / Notizen · From friends / Von Freunden · Public / Öffentlich · How many chapters does this book have? / Wie viele Kapitel
hat dieses Buch? · Make {n} chapters / {n} Kapitel anlegen · Everyone with this book shares the chapter list. You can add
chapters later. / Alle mit diesem Buch teilen die Kapitelliste. Du kannst später Kapitel hinzufügen. · You're on chapter {n} /
Du bist bei Kapitel {n} · Change / Ändern · Chapter {n} / Kapitel {n} · The whole book / Das ganze Buch · Only me / Nur ich ·
Friends / Freunde · Everyone / Alle · Who can see this / Wer das sehen kann · Visible to all members of BetterReads, with your
name and photo. Just this note. / Für alle Mitglieder von BetterReads sichtbar, mit deinem Namen und Foto. Nur diese Notiz. ·
Make visible to everyone / Für alle sichtbar machen · Can't be wider than the note you answer. / Kann nicht weiter sichtbar sein
als die Notiz, auf die du antwortest. · A note you can't see / Eine Notiz, die du nicht sehen kannst · Note removed / Notiz
entfernt · Removed by the moderator / Von der Moderation entfernt · No notes on chapter {n} yet. / Noch keine Notizen zu Kapitel
{n}. · A note on chapter {n} / Eine Notiz zu Kapitel {n}. Plurals through vue-i18n's plural forms; numbers in mono where the
app does.

## Tests

- **Vitest** (`web/tests/`): `noteVisibility` (defaults, clamp, memory, switch off), `roomThread` (veil and runs, buddy cases
  unchanged), the data layer against the stack (`notes-db.test.ts`: two members and a stranger, each level, the quote shapes,
  `chapters_already_set`, the switch via the service role).
- **Flow** `web/e2e/book-notes.spec.ts`, `@full`, iPhone WebKit like the others, seeded through the RPCs: Ida and Anna follow
  each other, Mo is a member with no relation.
  1. Ida opens Notes on a Book with no chapters, makes 43, opens chapter 5, writes at Friends; sets herself to chapter 5.
  2. Anna (Want to read, chapter 0): her Book page shows *From friends* "Ida · 1 note · chapter 5"; the Notes page shows chapter 5
     veiled with count 1 and no words anywhere on the page; **Show anyway** opens it; she replies.
  3. Ida writes an Only-me note: Anna never sees it, nor its count.
  4. Ida writes at Everyone (the line under the control is shown; after send the control is back on Friends): Mo sees it with the
     globe, and the *Public* row on his Book page; Mo does not see the friends notes or Anna's reply; a reply of Ida's quoting
     Anna shows Mo "A note you can't see".
  5. Ida narrows the public note to Friends: Mo no longer sees it, nor the *Public* row.
  6. The switch off (service role): Everyone disappears from Ida's control; a public note behaves as friends for Mo.
  7. Mo reports Ida's public note; the owner's inbox shows **Remove note**; removing leaves "Removed by the moderator" for all.
  8. Mo blocks Ida from her note: neither sees the other's notes any more.
  9. axe scan of the Notes page and a chapter in the dark theme; German at 360 px: the control and the rows do not overflow.
- **The guard**: the 7 buddy specs (`buddy-read`, `buddy-read-review`, `buddy-read-rehearsal`, `buddy-gestures`, `buddy-voice`,
  `buddy-voice-hold`, `buddy-suggestions`) pass unchanged in the `full-e2e` run; `tests/buddy-thread-view.test.ts` and the buddy
  store tests unchanged. Moves are pure moves first (one commit), then the notes work.

## Performance budget

The Notes page needs one call (`book_notes`) to draw; its answer for 43 chapters stays under 30 KB. A chapter loads 50 notes.
The notes routes are lazy chunks (with their store and the chat layer) and add nothing to the Book page's chunk but the
section and the button (≤ 3 KB gzip; the section's data call is the only new request on the Book page). No Realtime client on any
notes route.

## Docs

`docs/parity.md`: entries for *Notes, the Book page section*, *Notes page*, *Notes, a chapter*, *Notes, visibility*, *Owner
inbox: remove a note* (the house format: purpose, layout, states, actions, rules, copy keys, test ids, flows). `CONTEXT.md`: *Notes*,
*Chapter*, *Only me / Friends / Everyone*.

## Done when

The flows above and the 7 buddy flows pass in the PR's `full-e2e` run; Vitest passes; the screens match the mock-ups in light,
dark, EN, DE and at 360 px (attach shots of each in the PR); the PR is green on the checks named in [README.md](README.md).
Report the PR URL, what was not built, and anything a reviewer must look at (the moves of shared components first).
