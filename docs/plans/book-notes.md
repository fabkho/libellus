# Notes on a Book as the base, buddy reads on top

**Status: plan for the owner, documentation only. Draft PR #518, DO NOT MERGE.** Second version, 6 November 2026, against
`origin/main` `ee6893ce` (1.40.0), after the owner's review of the first ("Yes, I like this, I like the UI", with the design
restructured as below). Production measured read-only, counts only (Appendix C). Mock-ups: `docs/prototypes/book-notes/`
(static HTML on the app's tokens, copied from `web/app/assets/css/tokens.generated.css`), shots in `docs/images/book-notes/`.

**The owner's case:** "I am reading a book, he has not read it; I take notes per chapter so he can react later when he reads
it." And on the design: "We have notes, and buddy reads add functionality: being private is the most important one, and the
progress tracking, the timeline with the avatar icons showing where each of my friends currently is. That only makes sense
in the buddy read context."

## What the owner decided in the review

| Decision | Where |
|---|---|
| **Notes is the base; a buddy read is Notes plus a private audience and the timeline** | part 1 |
| **No join sheet, no pop-ups, no banners, no push**: a quiet *Notes from friends* section on the Book page | part 5 |
| **Notes and buddy reads are started separately.** The Notes page asks only for the number of chapters, then makes one thread per chapter | parts 2, 5 |
| **Chapters belong to the Book**, "when not already set by someone else" | part 2 |
| Notes now, no public rooms now (answers to questions 1 of the first version) | Appendix B |

## In ten lines

1. **Notes** = a Book's chapters, a thread per chapter, notes, replies, reactions, spoiler marks and the veil by the reader's
   own chapter. **Buddy read** = the same machinery plus (a) a **private** audience (only the invited), (b) **members**,
   invitations and the link, (c) the **timeline** with everybody's avatar, (d) live updates.
2. **Two room kinds on one machinery** (option A): one set of tables for chapters, messages, reactions and read cursors, one
   set of thread components; a notes room is one per Book, a buddy read is its own private room. Not an overlay of a buddy
   read on the notes room (option B): one thread mixing private and friend-visible messages is a leak waiting to happen.
3. **The chapters belong to the Book (the Work, so every edition shares them)**: whoever opens Notes first types "43", the 43
   threads exist for everybody with the Book. Chapters can be added at the end, never deleted once used; v1 has numbers, no
   names (no shared text, so nothing to moderate).
4. **Each note is seen by its author's friends** (members who follow each other) **and nobody else**. One Notes page per Book,
   a thread per chapter, and each reader sees her own and her friends' notes in it. Replaces the first version's "one room per
   author": authorship moves from the room to the note.
5. **The veil works by the reader's own chapter**: "You're on chapter 5" opens chapters 1 to 5; later chapters show a count
   and nothing else until she gets there or taps *Show anyway*. Her chapter comes from her reading progress (equal-sized chapters,
   rounded down) or she sets it; **nobody else ever sees it in Notes**. Seeing where friends are is the buddy read's.
6. **Measured**: 2 members, 1 pair who follow each other, 7 Books both have, on 4 of them one is ahead. The one buddy read in
   production was cut into 22 equal parts (by count) plus *The whole book*: fine-grained parts, close to chapters.
7. **Most of the first version's gaps disappear** (no invitation, no *Finish*, no cap, no copy to link, no host leaving); what
   remains is the chapter list, the friends rule, the position mapping and the entry points (part 3).
8. **Build: N1 notes base in the database (Opus), N2 the Notes page and the Book page (normal): about a week, and the owner
   can use it.** Nothing shipped is touched in N1; N2 moves the thread components into a shared folder, guarded by the 7
   buddy-read end-to-end flows.
9. **N3 re-bases the live buddy reads** on the shared tables (Opus): cheap now (1 read, 2 members, 23 Sections, 2 messages,
   1 stored recording), costly later. Ids are kept, so the recording's storage path stays valid; every public function keeps
   its name.
10. **Not in v1**: chapter names, voice in Notes, push, live updates in Notes, public rooms, direct messages (never).

## The recommendation

**Build Notes as the base now (N1 + N2, one week), then re-base buddy reads on it (N3) while production holds one read.**
The order ships the owner's use first and touches nothing live until the base has run for a while. Do not build public
rooms (Appendix B).

## What exists today (measured, production, 6 Nov 2026)

| Thing | Count |
|---|---|
| Members (accounts) | **2** (invite codes: 8, used 4 times; waitlist: 3) |
| Accepted follows / pairs who follow each other | 2 / **1** |
| Library entries | 843 (finished 538, reading 6, want to read 299); 28 on Manual books |
| Works both members have | **7**; **4** with one ahead (finished vs want to read 3, reading vs want to read 1); both finished 3 |
| Reading entries with progress set | 5 of 6 (pages on 9 sessions, percent on none) |
| **Buddy reads** (what N3 moves) | **1** read (active), **2** members, **23** Sections (22 equal parts by count + *The whole book*; no chapter labels), **2** messages (1 text, 1 voice), **1** stored recording in `buddy-voice`, 0 reactions, 0 read cursors, 0 removals |
| Catalogue Books with a page count | 671 of 869; 699 of 869 tied to a Work by Open Library or ISBN |
| Works with 2+ editions | 48; page counts differ by 13 % (median), up to 40 % |
| Reports / blocks / feedback | 0 / 0 / 0 |
| Database | 43 MB of the Free plan's 500 MB |

## 1. The layering

### 1.1 What becomes the base, what stays buddy-only (from the live code)

| Piece today | Where | Becomes |
|---|---|---|
| Sections (a Book's parts, *The whole book* last, fractions) | `buddy_read_sections`, `private.buddy_sections_parse` | **base** (`room_sections`); for Notes they are the Book's chapters |
| Messages: text, voice, quote (`reply_to`), spoiler mark, tombstone, delete | `buddy_messages`, `post_buddy_message`, `delete_buddy_message`, `send_buddy_voice` | **base** (`room_messages`) |
| Reactions (the six emoji, one per member and message) | `buddy_reactions`, `react_to_buddy_message` | **base** |
| Read cursors and unread counts that skip veiled Sections | `buddy_section_cursors`, `buddy_read_members.last_read_at`, `private.buddy_unread`, `buddy_counts` | **base** (`room_cursors`; the room thread's cursor moves there too) |
| Report to the owner's inbox | `report_buddy_message` → `feedback` (`kind = 'report'`) | **base** |
| Blocks hide messages between two members | `private.buddy_hidden`, `public.blocks` | **base** |
| The veil and *Show anyway* (peeks kept on the device) | `utils/buddyThread.ts`, `components/together/ShowAnyway.vue` | **base** |
| Rate limits (30 a minute, 600 a day; reactions 60 a minute) | `post_buddy_message`, `private.buddy_rate_window` | **base** |
| Voice storage and the sweep | bucket `buddy-voice`, `private.buddy_voice_trash`, `buddy-voice-sweep` | **base machinery**, used by buddy reads; Notes later (N4) |
| A position: auto from progress plus a hand | `buddy_read_members.auto_through/hand_through/read_through`, `private.buddy_fraction`, `set_buddy_hand` | **split**: the base asks "which chapters are open for her"; the buddy read stores it per member for the timeline, Notes works it out per reader (part 2.5) |
| Host, members, invitations, link, removal, leave, finish, archive, the 12 cap, the 10-active cap | `buddy_reads`, `buddy_read_members`, `private.buddy_invite`, `join_buddy_read`, … | **buddy only** |
| The timeline (avatars in their Section) and *where everybody is* | `private.buddy_where`, `components/together/Track.vue` | **buddy only** |
| Live updates (a private Realtime topic per member) | `20261113040000_buddy_read_realtime.sql`, `data/buddyLive.ts` | **buddy only** (Notes is read when opened) |
| Thread screen | `pages/together/[id]/[section].vue` (571 lines: `UiChatThread`, `UiBubble`, `UiComposer`, `ReportSheet`, `ShowAnyway`) | **base** component `components/room/Thread.vue`, used by both pages |
| Room screen | `pages/together/[id]/index.vue` (272 lines: hero, `Track`, `UiThreadRow` rows, `MarkerSheet`, `RoomMenu`, `MembersSheet`, `InviteSheet`) | rows and position line **base** (`components/room/SectionRows.vue`); hero, track, menu, members, invite **buddy only** |
| Store and data | `stores/buddyRead.ts` (998 lines), `data/buddyReads.ts` (649) | thread half (open, page, send queue, react, delete, report, peeks) **base** (`stores/room.ts`, `data/rooms.ts`) behind one adapter per kind; reads, members, live **buddy only** |
| Setup, invitations, entry picker, Home card, Book page action | `components/together/{SetupSheet,InviteSheet,Picker,Link,EntryPicker,Invitations,InvitationRow,BookRow}.vue`, `components/home/Together.vue` | **buddy only** |

The chat package (`@fabkho/chat`: send queue, threads and chapters, veil helpers, behind an adapter) is already the base on the
client side; Notes adds a second adapter, not a second chat.

### 1.2 A buddy read: its own room on the same machinery (A), or an overlay on the notes room (B)

| | **A. Two room kinds, one machinery** (recommended) | B. A buddy read as an overlay on the Book's notes room |
|---|---|---|
| What it is | `rooms.kind` is `notes` (one per Book, audience: each author's friends) or `buddy` (one per read, audience: its members). Same tables for Sections, messages, reactions, cursors; same thread components | One room per Book. A buddy read adds a member list on top, and its members' messages are marked private |
| Private | by construction: a buddy room's messages are read only through membership | a rule per message ("private to read X") in a shared thread; one wrong filter and a private message shows on the friends' Notes page |
| Chapters | a buddy read has its own Sections (the host's choice, as today), and can copy the Book's chapters at setup (N4) | forced to the Book's chapters; today's reads by count or pages would not fit |
| Migration of the live read | copy into the shared tables, ids kept (N3) | merge it into a notes room of its Book: its 23 Sections against the Book's chapter list, which does not exist yet |
| Code | every function knows its kind; the buddy functions keep their gates | every read of a notes thread must also filter buddy-private messages: the riskiest place to add a condition |

**A.** Privacy is the buddy read's most important feature, and A gets it from the structure instead of from a filter.

### 1.3 The tables, and how to get there in small safe steps

Target (all `public`, RLS on with no policies, `revoke all` from `anon`/`authenticated`, reached only through
`security definer` functions as today):

- `rooms` (`id`, `kind` notes|buddy, `book_id` the edition it was started on, `work_key`, `created_at`); unique
  `(work_key) where kind = 'notes'`.
- `room_sections` (today's `buddy_read_sections` with `room_id`; `to_fraction` nullable: a notes chapter's band is worked out
  from the chapter count, part 2.5).
- `room_messages`, `room_reactions`, `room_cursors` (today's buddy tables with `room_id`).
- `note_positions` (`room_id`, `member_id`, `hand_chapter`): a reader's own chapter when she set it. Nothing else of hers.
- **Buddy only**: `buddy_reads` keeps its name and its buddy columns (host, status, link, start date, how the Sections were
  made) and its `id` becomes a reference to `rooms.id`; `buddy_read_members`, `private.buddy_read_removed`, `private.buddy_calls`
  stay as they are.

Steps:

1. **N1 adds the shared tables and Notes on them. Buddy tables untouched.** Zero risk to what is live.
2. **N3 moves buddy reads onto them**, in one migration: insert a `rooms` row per buddy read **with the same id**, copy its
   Sections, messages, reactions and cursors **with their ids**, point `buddy_reads.id` and the members at `rooms`, replace the
   40 functions that read the moved tables (77 buddy functions in all; the list is in the schema snapshot), move the Realtime
   triggers to `room_messages` (`kind = 'buddy'` only), and rename the old tables `*_retired`. The migration counts rows before
   and after and stops if they differ. Every public function keeps its name and arguments (installed apps call them), so the
   web app needs no change on the day. The recording stays where it is: its path is `<read id>/<author>/<client id>.m4a`, and
   the read id is kept.
3. **N3b, one release later, drops the `*_retired` tables.** Forward-only as `AGENTS.md` requires; a mistake in N3 is
   corrected by the next migration, with the old rows still there to copy from.

Why not rename the buddy tables in place first: a rename breaks every function body that names the table (plpgsql bodies are
text), all in one step, before anything new exists. Copy-and-switch puts the new tables next to the old and switches readers
over in one transaction, with a count check.

## 2. Who owns the chapters: the Book

### 2.1 Shared chapters with per-note visibility (i), or per-author rooms sharing the chapter list (ii)

| | **(i) One notes room per Book (Work), shared chapters, each note seen by its author's friends** (recommended) | (ii) One notes room per author, chapter list shared from the Book |
|---|---|---|
| The owner's flow ("open Notes, set 43 chapters if nobody did, go to chapter 5, write") | exactly: one Notes page per Book | a page per author: "your notes" vs "Ben's notes", a switcher |
| A friend's reply to my note | lives in the chapter thread; seen by the replier's friends | lives in my room; seen by **my** friends, also those who are not his: more exposure, not less |
| Two friends with notes on one Book | one thread per chapter shows both | two rooms to open |
| Counts on the Book page | one line: "Ben and Jo · 14 notes" | a row per author |
| Later, open to all members (Appendix B) | a change of the visibility rule | a new structure |

**(i).** The first version's "one room per author per Book" came from building on the buddy read's host and members; with
Notes as a base that has neither, the author belongs on the note, and the room belongs to the Book.

### 2.2 Chapter rules

- **One chapter list per Work**, stored once as the notes room's Sections: chapters 1 to N, then *The whole book* (for what can
  only be said at the end; it opens when she has finished). "Before you start" is not in Notes (it is a buddy read's room).
- **Setting it**: any member with the Book in her Library (any edition, any status) may set the count while none is set.
  The Notes page asks one question, "How many chapters does this book have?" (mock-up 2), and makes them.
- **Two at the same instant**: the room is created under a lock on its Work; the second gets `chapters_already_set` with the
  list, and her page simply shows it (her count is not used).
- **Adding**: anyone with the Book may add chapters at the end (a wrong count is usually too low). Existing chapters keep
  their ids and their notes.
- **Removing**: only chapters at the end that hold no note from anyone (a typo of 430 is fixable; a used chapter is never
  deleted). `buddy_sections_locked` does not apply to Notes; buddy reads keep it.
- **Names**: none in v1. Chapters are numbers, worded in the reader's language ("Chapter 5", "Kapitel 5"). A shared name is
  text anyone with the Book could write and everyone with the Book would read; a title can also spoil (today's veil hides a
  veiled Section's title for that reason). "Name my chapters" later, as an open question.
- **Prologue, epilogue, interludes**: the Notes page says "count them too"; editions that number differently are corrected by
  the reader's own chapter (2.5).
- **Manual books**: no Notes (they are hers alone; nobody else can open them).

### 2.3 Who sees whose note

A note, a reply and a reaction are seen by **their author and the members who follow her and whom she follows (both accepted),
not blocked either way**. Nobody else. Example: Anna follows each other with Ben and with Jo; Ben and Jo do not.

| In chapter 5 | Anna sees | Ben sees | Jo sees |
|---|---|---|---|
| Anna's note | ✓ | ✓ | ✓ |
| Ben's reply to Anna | ✓ | ✓ | – |
| Jo's note | ✓ | – | ✓ |
| Anna's reply quoting Ben | ✓ | ✓ | ✓, the quote reads "A note you can't see" (never its words or author) |

So each reader's chapter thread is her friends' conversation. Counts (rows, Book page) and reaction pills count only what she
may see. The alternative, "a reply is seen by everyone who sees the note it answers", would show Ben's words to Jo, whom Ben
never chose: open question 4.

### 2.4 Editions and the Work

The room's key is one function, `private.book_work_key(book)`: the Work (`book_works.work_id`) when the Book is tied to it by
Open Library or ISBN (699 of 869 Catalogue Books), else the Book itself (a room for that edition). Title-matched ties (70) are
not trusted for this, because two books can share a title. The buddy read's own rule for "the same Book" (`link_buddy_entry`:
the same `openlibrary_work_key`) moves onto the same function in N3, so both layers agree; 13 Books are tied differently by the
two rules today. Chapters, not pages, are what editions share, so a chapter list made from one edition serves all.

### 2.5 Her chapter, and the veil

- **From her progress**: her furthest point in the Book across her entries of the Work, as a fraction (page over her edition's
  page count, or the percent; a finished read at any time is the whole Book). With N chapters and no chapter sizes known, she is
  **on chapter `floor(fraction × N)`, at least 1 once she has started** (equal-sized chapters, rounded down, so a guess that is
  off is more often behind than ahead).
- **By hand**: "You're on chapter 5 · Change" at the top of the Notes page. A hand choice **wins in both directions** (an
  estimate can be wrong either way) until she picks *Automatic* again. Stored in `note_positions`.
- **What is open**: chapters 1 to her chapter (the one she is on included: that is where she writes), *The whole book* once she
  has finished. Not started (or not in her Library): nothing open; every chapter can still be opened with *Show anyway*.
- **A friend behind**: Anna writes in chapter 5. Ben is on chapter 2, so on his Notes page chapter 5 is a veiled row (its
  number and a count, no faces, no new-dot); when his reading or his hand reaches 5, it opens, with its count of new notes
  waiting. A note marked *Spoiler* stays veiled inside an open chapter until he taps it, as today.
- **Nobody sees her chapter.** In Notes no one sees anyone's position, not even friends; posting in chapter 5 says only that
  she wrote about chapter 5. The timeline of who is where is the buddy read's (part 1).
- **The veil stays the app's**, as in buddy reads: the database answers a chapter's notes to whoever may see them, and the app
  does not ask for a veiled chapter before *Show anyway*. A courtesy between friends, not a secret.
- **Buddy reads keep their own rule** ("read through" Sections, the hand only opens more, positions shown on the timeline).

### 2.6 What the owner must decide here

Open questions 2 to 8 (part 8): chapters belong to the Work; who may set, add and remove; no names in v1; who sees a reply;
"friends" means following each other; the chapter rule; *The whole book*.

## 3. What is missing today, under the new model

| # | Gap in the first version | Now |
|---|---|---|
| G1 | Friends cannot open her notes without an invitation | **gone**: Notes has no invitation; visibility is friendship |
| G2 | No chapter can be added once a note exists (`buddy_sections_locked`) | **changed**: Notes adds at the end and removes unused chapters at the end; buddy reads keep the lock |
| G3 | *Finish* stops new joins | **gone** for Notes (no host, no finish); unchanged for buddy reads |
| G4 | A friend who finished before joining is "not set" (`buddy_fraction`) | **gone** for Notes: the furthest read at any time counts; unchanged for buddy reads |
| G5 | Notes rooms eat the cap of 10 active reads | **gone**: Notes has no membership |
| G6 | His copy is linked by hand | **gone** for Notes: worked out from all his entries of the Work |
| G7 | No entry points | **still needed**: *Notes* on the Book page, *Notes from friends* section (N2) |
| G8 | No notification | **by design** in v1: no push, no pop-ups; the new-dots on the Notes page and the count on the Book page |
| G9 | Buddy words for notes | **gone**: separate pages |
| G10 | Who owns a notes room when its author leaves | **gone**: the room is the Book's; she deletes her own notes |
| new | One rule for "the same Work" across both layers | N1 (`private.book_work_key`), buddy moves onto it in N3 |
| new | The friends rule, counted per reader (rows, Book page, reactions, quotes) | N1 |
| new | Her chapter from progress (bands) and by hand | N1 |
| new | The thread components shared between the two pages | N2 (client), N3 (data) |

## 4. Privacy

- **Notes** show each note with its author's name and photo to her mutual friends, who already see both
  (`private.member_card`, `private.can_see_photo`). Nothing of her position is shown to anyone.
- **A note says she has the Book.** Her friends learn it from the *Notes from friends* section. When the Book is hidden from
  followers (`library_entries.hidden`) or her switches hide that shelf, the Notes page says so in one line ("Your friends will
  see your notes on this book"); her switches are not changed. Open question 12.
- **The chapter count** is shared with every member who has the Book, **without her name** (who set it is kept only to
  limit abuse, and goes with her account).
- **Blocks**: a blocked pair never sees each other's notes, replies or reactions, in Notes as in buddy reads.
- **Deletion**: her notes, replies and reactions go with her account (`delete_my_account` cascades); a note she deletes leaves
  "Note removed" where someone answered it (as buddy reads do).
- **Buddy reads** are unchanged: private to the invited, Section only on the timeline.
- **The privacy notice** (`web/app/legal/privacy.ts`, both languages, version line): a new bullet next to *Buddy reads*:
  - EN: "**Notes on books (only if you write one).** Notes you leave on a chapter of a Book, your replies and your reactions.
    Your friends (members you follow who follow you back) see them with your name and photo; nobody else does. Which chapter you
    are on is worked out from your reading progress (or set by you) and used only to keep later chapters closed for you: nobody
    else sees it. If you set how many chapters a Book has, that number is shared with every member who has the Book, without
    your name."
  - DE: "**Notizen zu Büchern (nur wenn du eine schreibst).** Notizen, die du zu einem Kapitel eines Buchs hinterlässt, deine
    Antworten und deine Reaktionen. Deine Freunde (Mitglieder, denen du folgst und die dir folgen) sehen sie mit deinem Namen und
    Foto, sonst niemand. Bei welchem Kapitel du bist, wird aus deinem Lesefortschritt berechnet (oder von dir gesetzt) und nur
    genutzt, um spätere Kapitel für dich geschlossen zu halten: niemand sonst sieht es. Wenn du festlegst, wie viele Kapitel ein
    Buch hat, wird diese Zahl ohne deinen Namen mit allen Mitgliedern geteilt, die das Buch haben."
  - `docs/legal-checklist.md`: a *Notes* line beside *Buddy reads*.

## 5. The experience

| Screen | What | Mock-up |
|---|---|---|
| **Book page** | Two quiet buttons side by side under *Update progress*: **Notes** and **Read together** (the buddy read, as today). Below them, only when a friend has notes on this Book: the section **Notes from friends**, one row: their faces, "Ben and Jo", "14 notes · chapters 1–9", a chevron to the Notes page. No pop-up, no banner, no count on the button | 1 |
| **Notes page, no chapters yet** | "How many chapters does this book have?", a number with − and +, **Make 43 chapters**, one line that the list is shared and can grow. Nothing else | 2 |
| **Notes page** | Hero (cover, "Notes", title, "Yours and your friends' · 43 chapters"), "You're on chapter 5 · Change", then the chapters as the buddy room's rows: number, "Chapter k", the faces of the friends who wrote there, the count, the new-dot; veiled rows after her chapter. ⋯ holds *Add chapters*. No timeline, no members, no invite | 3 |
| **A chapter** | The buddy read's thread screen: notes as bubbles with name and face, quotes, reactions, the *Spoiler* chip, *Show anyway* on a spoiler; composer "A note on chapter 5" | 4 |
| **Buddy read** | The same rows and threads, plus what the buddy read adds: "with Ben and Mira", **Private · only the 3 of you**, the timeline with avatars, *Where are you?*, members and invite in ⋯ | 5 |

![The Book page](../images/book-notes/1-book-light-en.jpg)
![The Notes page before anyone set the chapters](../images/book-notes/2-chapters-unset-light-en.jpg)
![The Notes page](../images/book-notes/3-notes-dark-en.jpg)
![Chapter 5](../images/book-notes/4-chapter-light-en.jpg)
![A buddy read: the base plus what it adds](../images/book-notes/5-buddy-dark-en.jpg)

German and 360 px shots are in the same folder (`*-de*.jpg`, `3-notes-light-de-360.jpg`).

**Reading, not live.** The Notes page and a chapter are read when opened and when the app comes back to the front, with a pull
to refresh; no Realtime connection (a note arriving while a chapter is open is rare and can wait). Buddy reads stay live.

**Empty states.** No chapters: mock-up 2. A chapter without notes: "No notes on chapter 5 yet." over the composer. No friend
with notes: the Book page has no section at all.

## 6. Build plan

Every PR follows `CONTRIBUTING.md` (conventional title, pgTAP for every rule, `pnpm schema:snapshot`, a parity entry, EN and DE
copy). Sizes in one worker's days (M ≈ 1, L ≈ 2–3). Tiers as `AGENTS.md`: hard = Opus, normal = DeepSeek on GOAT.

| # | PR | Size | Tier | After | Touches shipped code? |
|---|---|---|---|---|---|
| **N1** | **Notes base, database.** `rooms`, `room_sections`, `room_messages`, `room_reactions`, `room_cursors`, `note_positions`; `private.book_work_key`; the friends rule (`private.note_visible`); `book_notes(book)` (chapters, counts and faces for her, her chapter), `set_book_chapters`, `add_book_chapters`, `remove_book_chapters`, `set_note_chapter`, `friends_notes(book)` for the Book page; the shared `room_messages`/`post_room_message`/`react_to_room_message`/`delete_room_message`/`report_room_message`/`mark_room_read` for `kind = notes`; rate limits as buddy messages; text only; no Realtime. pgTAP: friends, one-way follow, blocked, not friends with each other (the table in 2.3), the race on setting chapters, removing a used chapter refused, the chapter rule | L | **hard (Opus)** | – | no |
| **N2** | **The Notes page and the Book page.** `components/room/{SectionRows,Thread}.vue`, `ShowAnyway` and `ReportSheet` moved from `components/together/` and used by both pages; `stores/room.ts`, `data/rooms.ts` with a notes adapter; `pages/notes/[book]/index.vue` and `[chapter].vue`; the chapter-count prompt; *Notes* and *Notes from friends* on the Book page | L | normal | N1 | **yes, client**: the buddy thread and room pages switch to the moved components. Guarded by the 7 buddy end-to-end specs (`buddy-read`, `-review`, `-rehearsal`, `-gestures`, `-voice`, `-voice-hold`, `-suggestions`, run `@full`) and `tests/buddy-thread-view.test.ts` |
| **N3** | **Buddy reads re-based on the base** (part 1.3): the copy-and-switch migration with counts checked, the 40 functions rewritten, Realtime triggers moved, public function names kept; `link_buddy_entry` onto `book_work_key` | L | **hard (Opus)** | N1, a week of N2 in use | **yes, database**: the riskiest PR. Guarded by the 6 buddy pgTAP files (4,453 lines) unchanged and green, the 7 end-to-end specs, a run on a restored copy of production (docs/OPERATIONS.md, restore), and after the release: the one read opens, its 2 messages show, its recording plays |
| N3c | Buddy pages on the base store (`stores/room.ts` with a buddy adapter); `stores/buddyRead.ts` keeps only reads, members and live | M | normal | N3 | yes, client; same guards |
| N3b | Drop the `*_retired` tables, one release after N3 | S | normal | N3 released | no |
| N4 | Polish: voice in Notes (the bucket's read rule becomes "may see this message"; Opus review), buddy setup offers "the Book's chapters (43)", privacy notice EN and DE, legal checklist, `CONTEXT.md` (*Notes*, *Chapter*), parity | M | normal | N2, N3 | small |

**About 10 worker-days. In one week: N1 (Opus, 2–3 days) and N2 (normal, 3 days, started on N1's branch once the function
signatures are fixed on day 1).** Then the owner uses Notes; N3 the week after, N3c and N4 after it, N3b one release later.
No switch: buddy reads are on for everybody since 1.34, and Notes risks nothing that a switch would protect.

**Not in v1**: chapter names, voice in Notes (N4), push, Realtime in Notes, a Home card for Notes, a profile row "her notes",
friends of friends, public rooms (Appendix B), direct messages (never).

## 7. Risks

| Risk | Likelihood | Effect | Mitigation |
|---|---|---|---|
| A note is shown to someone who is not its author's friend | low | trust | Opus on N1; pgTAP for every row of the table in 2.3; the rule in one function used by every reader |
| N3 breaks the live buddy read | medium | the one read stops working | copy-and-switch with count check; ids kept; old tables kept a release; restored-copy rehearsal; pgTAP and end-to-end unchanged |
| N2's move of the thread components changes buddy-read behaviour | medium | a regression in a live screen | pure move first, then the notes adapter; 7 end-to-end specs |
| The chapter estimate (equal bands) opens a chapter too early | medium | a small spoiler | rounded down; "You're on chapter k · Change" always on top; spoiler marks; the hand wins |
| A wrong chapter count blocks a Book for everyone | low | odd numbers | add at the end; remove unused chapters at the end |
| Editions number chapters differently | medium | a note sits one chapter off for some readers | the reader's own chapter by hand; "count prologue and epilogue" |
| Notes reveal a Book she hid from followers | low | a privacy surprise | one line on the Notes page; open question 12 |
| Nobody uses it | low–medium | a week of work | measured: 4 of 7 shared Books are the async shape; the one buddy read already uses 22 fine parts |

## 8. Open questions for the owner

Answered in the review and removed: notes now (yes), public rooms now (no), the join sheet (no), one start form (no). Each
below with my recommendation; "yes" takes it, "if no" says what changes.

1. **Layering A: notes rooms and buddy reads are two kinds of room on one machinery**, not a buddy read laid over the notes
   room. *Recommend: yes.* If B: every notes query filters private buddy messages; today's reads by count or pages must become
   chapters.
2. **The chapter list belongs to the Work**, shared by every edition and every member with the Book. *Recommend: yes.* If a
   list per author: the Notes page shows one list per friend, and friends' notes on "chapter 5" may not be the same chapter.
3. **Anyone with the Book may set the count when none is set, and add chapters at the end; only unused chapters at the end can
   be removed.** *Recommend: yes.* If only the first setter may change it: a wrong count waits for her.
4. **A reply is seen by its own author's friends** (not by everyone who sees the note it answers). *Recommend: yes.* If no: a
   friend's reply reaches your other friends, who never chose him.
5. **"Friends" means members who follow each other**, checked whenever a page is read. *Recommend: yes.* If followers: someone
   she never followed back reads her notes.
6. **Her chapter: equal-sized chapters, rounded down, from her furthest progress; her hand choice wins both ways; nobody sees
   it.** *Recommend: yes.* If the buddy rule (the hand only opens more): a too-high estimate cannot be lowered.
7. **"You're on chapter 5" opens chapters 1 to 5** (her current chapter included). *Recommend: yes.* If "read through" as in
   buddy reads: she cannot read friends' notes on the chapter she is writing about.
8. **No chapter names in v1; *The whole book* as the last thread, open once she has finished.** *Recommend: yes.* If names
   now: shared text needs a rule for who may rename and a veil for titles.
9. **Friends' notes can be read without the Book in her Library; setting chapters and writing need the Book.** *Recommend:
   yes.* If writing is free: chapters could be set by someone who never had the Book.
10. **Text only in v1; voice in N4.** *Recommend: yes.* If voice now: N1 grows by the bucket's rule (Opus).
11. **No push, no Realtime, no Home card for Notes in v1.** *Recommend: yes.* If a Home card: one more PR (M), still no push.
12. **A Book hidden from followers still allows notes, with one line saying friends will see them.** *Recommend: yes.* If no:
    the *Notes* button is disabled on hidden Books.
13. **Re-base the live buddy reads now (N3) with copy-and-switch, keeping every public function name.** *Recommend: yes.* If
    later: the two layers live side by side longer, and every new buddy read makes the move costlier.
14. **The buddy setup offers "the Book's chapters" when a list exists.** *Recommend: yes (N4).*
15. **No Notes on Manual books.** *Recommend: yes.*
16. **No switch.** *Recommend: yes.*

---

## Appendix A: until it is built

The owner's case runs today on a buddy read, with care: *Read together*, Sections **by a list** with every chapter (adding is
not possible once a note exists), invite the friend whenever he starts, never press *Finish*, and a friend who read it before
sets *Where are you? → I've read it*.

## Appendix B: later, all members (public rooms), kept short

**What changes if we ever open it up.** Under layering A and chapters per Work, "all members" is a change of the visibility
rule in 2.3 (a note seen by every member with the Book), not a new structure. What it brings:

1. **Numbers first.** Today 2 members and no Work held by 3. A room feels alive when a few people post in the same weeks;
   with one reader in ten posting and one in three who has the Book opening it, that is about 100 readers of one Book, which a
   typical Book reaches at a few thousand members. Revisit when open sign-up (#331) is live and at least 10 Works have 30 or
   more members reading or finished (Appendix C).
2. **Identity**: a short public name and photo off by default; a tap on a face gives *Report* and *Block*, never a profile or
   a follow (the app has no member directory and must not get one through a forum).
3. **Moderation before launch**: the report flow exists (owner's inbox, 5 an hour, 20 a day), but no alert, no owner removal,
   no ban, no notice to the author; and chapter names would need a rule.
4. **Law (a lawyer's question, not advice)**: whether the EU Digital Services Act applies to a free, members-only app; if so,
   notice and action (Art. 16), statement of reasons (Art. 17), a contact point (Art. 12), rules in terms (Art. 14), and the
   small-provider exemptions. The imprint (`IMPRINT_ENABLED = false`) likely returns.
5. **#331**: its report flow (WP-25), name rules (WP-26) and launch texts (WP-27) come first; captcha and the mail budget
   (WP-24) are independent.

| Risk if opened | Likelihood | Effect | Mitigation |
|---|---|---|---|
| Empty rooms | very high at today's size | looks dead | wait for the numbers |
| Harassment or spam without owner tools | medium after open sign-up | members hurt, legal exposure | owner tools and alert first |
| Illegal content noticed late | low–medium | liability once known | alert, removal within a day, a record |
| Strangers learn who reads what | medium | privacy | short names, photo off, no positions |
| Minors meet strangers | low | serious | an age line at sign-up (WP-24) first |

Mock-ups kept for that phase: [first use](../images/book-notes/later-1-first-use-light-en.jpg),
[the mini card](../images/book-notes/later-2-member-dark-en.jpg), [the report sheet](../images/book-notes/later-3-report-light-de.jpg).

## Appendix C: method, queries, what I could not verify

`supabase db query --linked` from the main checkout against production (`ltedflcewdcqtqzcjeyr`), read-only, counts only; no
member id, name or title printed.

```sql
-- Pairs who follow each other, and the Books both have, by Work (book_works, else the Open Library work key, else the Book)
with f as (select follower_id a, followee_id b from public.follows where accepted_at is not null),
mutual as (select f1.a, f1.b from f f1 join f f2 on f2.a = f1.b and f2.b = f1.a where f1.a < f1.b),
e as (select le.member_id m, le.status::text st,
             coalesce(bw.work_id::text, b.openlibrary_work_key, 'b:' || b.id::text) wk
        from public.library_entries le join public.books b on b.id = le.book_id
        left join public.book_works bw on bw.book_id = b.id
       where b.owner_id is null)
select (select count(*) from mutual) mutual_pairs,
       count(*) shared, count(*) filter (where ea.st <> eb.st) one_ahead
  from mutual p join e ea on ea.m = p.a join e eb on eb.m = p.b and eb.wk = ea.wk;

-- What N3 moves
select (select count(*) from public.buddy_reads) reads, (select count(*) from public.buddy_read_members) members,
       (select count(*) from public.buddy_read_sections) sections, (select count(*) from public.buddy_messages) messages,
       (select count(*) from public.buddy_reactions) reactions, (select count(*) from public.buddy_section_cursors) cursors,
       (select count(*) from storage.objects where bucket_id = 'buddy-voice') recordings;

-- The public-room trigger (Appendix B): Works with at least 30 members reading or finished
select count(*) from (
  select coalesce(bw.work_id::text, 'b:' || b.id::text) wk
    from public.library_entries le join public.books b on b.id = le.book_id
    left join public.book_works bw on bw.book_id = b.id
   where b.owner_id is null and le.status in ('reading', 'finished')
   group by 1 having count(distinct le.member_id) >= 30) x;
```

Function counts are from `supabase/schema-snapshot/functions/` (77 named `buddy*`; 40 read `buddy_reads`, `buddy_read_sections`,
`buddy_messages`, `buddy_reactions` or `buddy_section_cursors`). **Not verified**: how often the equal-band estimate lands in
the right chapter on real books (no chapter data exists to test it against); whether `UiThreadRow` takes 43 rows without a
performance cost on a slow phone (the buddy room has drawn at most 23); the copy-and-switch migration is designed here, not
rehearsed.
