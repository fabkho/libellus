# Libellus — Spec Sheet (v1, 2026-10-02)

> A mobile-first book tracker that nails one loop: **search → add → start → finish**. Personal first,
> ready for a handful of invited people later (first: Fabian's girlfriend, coming from Goodreads).

This is the condensed version. The full spec — user stories, implementation and testing decisions —
is issue [#1](https://github.com/fabkho/libellus/issues/1). The words used here are defined in
[CONTEXT.md](CONTEXT.md).

## 1. Goals

- Find a book fast (Apple Books, OpenLibrary and Libellus' own Catalogue in parallel), put it on
  *Want to read*, mark when reading starts, and on finishing record the date, a quarter-star rating
  and a few words — on the phone, in a few taps, with sharp covers.
- Re-reads and abandoned attempts are first-class: every read is a Reading session with its own dates.
- Custom Collections group books freely.
- Invite-only accounts with a six-digit email code.
- Replace Fable: import its history once, then delete it.
- Built so a later Swift/Kotlin port is mechanical (the Trappist strategy).

Non-goals (v1): social features (friends, feed, sharing), a work/edition hierarchy, fuzzy dates, a
"Paused" state, open sign-up, Sign in with Apple/Google, page progress, German UI, desktop layouts.

## 2. Platform & Stack

**Web first**: a mobile-first web app, installable from the home screen, is the reference. Native
apps are a later decision (milestone after go-live): Swift ported from the web behaviour, Kotlin 1:1
from Swift.

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Nuxt 4, SPA** (`ssr: false`), TypeScript | Everything personal is behind sign-in. `nuxt generate` → static files |
| Installable | `@vite-pwa/nuxt` | Explicit precache patterns; app shell and latin-subset fonts precached |
| Architecture | Page → Pinia store → framework-free repository (`app/data/`) → Supabase client | Mirrors View → ViewModel → Repository, so a native port maps 1:1 |
| Backend | **Supabase** (Postgres, Auth, RLS) via `@supabase/supabase-js` | Rules live in the database (constraints, triggers, RPC, RLS). Hosted in `eu-central-1` |
| Auth | Invite code + six-digit email code (Trappist's flow) | No passwords, no magic links (they would open Safari, not the PWA) |
| UI | Tailwind v4 on generated tokens | Mobile patterns only: tab bar, sheets, 44 pt touch targets |
| Design tokens | `design/tokens.json` → Style Dictionary → Tailwind `@theme` CSS and Swift | Never hand-edit generated files; CI checks them |
| Copy | `@nuxtjs/i18n`, one locale, `web/i18n/locales/en.json` | No hard-coded strings; German and native string catalogues map the keys |
| Search sources | Own Catalogue (Postgres full-text), Apple Books (iTunes Search), OpenLibrary | Client-side, in parallel; all allow cross-origin reads. Google Books later via an Edge Function |
| Hosting | Cloudflare Pages, served at `libellus.fabkho.dev` (`libellus-3q1.pages.dev` stays as the Pages host) | Preview deploy per pull request |

## 3. Domain

Glossary: [CONTEXT.md](CONTEXT.md). In one paragraph: a **Member** has a **Library** of **Library
entries**; each entry points at one **Book** (one edition) and has exactly one **Status** (*Want to
read*, *Currently reading*, *Finished*), derived from its **Reading sessions**. A session is one
read: start, end, outcome (*finished* or *abandoned*), quarter-star **Rating**, review. Books come
from the shared **Catalogue** or are private **Manual books**. **Collections** are non-exclusive
custom shelves.

## 4. Data model (shape, not final SQL)

- **books** — the Catalogue plus Manual books: title, ordered authors, ISBN-13/10, page count, year,
  language, publisher, description, cover URL + thumbhash + two cover colours, source (`apple` | `openlibrary` |
  `manual` | `import`), source identifiers, `owner_id` only for Manual books. Unique on ISBN-13 for
  non-manual books and on source identifiers.
- **library_entries** — member, book, status (`want_to_read` | `reading` | `finished`), added at.
  Unique per member and book. `status` is a stored column for filtering and sorting, but derived:
  triggers recompute it from the entry's sessions and overwrite anything written into it.
- **reading_sessions** (`supabase/migrations/20261003102707_reading_sessions.sql`) — entry (deleted
  with it), `started_on` and `ended_on` (calendar days, `date`, no time zone), `outcome`
  (`finished` | `abandoned`, null while the session is open), `rating` (smallint quarters 1–20,
  null = unrated; 15 = 3.75 stars), `review`, `abandon_reason`, created at. Table checks: an open
  session has a start and no end, Rating, review or reason; a Rating only on a finished session, an
  abandon reason only on an abandoned one, a review only on a closed one (non-blank, ≤ 10,000
  characters); `ended_on >= started_on`. A finished session may have no dates at all (past reads,
  imports). One open session per entry (partial unique index).
- **latest session** — `latest_session(library_entries)`, a to-one computed relationship: the open
  session if there is one, otherwise the one that ended last (`ended_on`, then `started_on`, then
  created at). It decides the Status and is what lists show and sort by.
- **collections** (member, name, position) and **collection_entries** (collection, entry, position).
- **invite_codes**, **accounts** — as in Trappist.

Rules enforced in the database: status derived from sessions (none → *Want to read*, latest open →
*Currently reading*, latest closed — finished or abandoned → *Finished*); at most one open session
per entry; `ended_on >= started_on`; no future dates (a trigger refuses a day later than today in
the earliest time zone, UTC+14, since the database cannot know the member's; clients hold the member
to their own today); a Rating only on a finished session; deleting an entry deletes its sessions and
memberships, deleting a collection never deletes entries; adding to a collection creates a *Want to
read* entry if needed, in the same transaction. RLS: library data (entries, sessions) only for its
member, readable but never written directly; Catalogue readable by every member, written only through
the add-to-library action; Manual books only for their owner. The owner's import (#17) writes as the
service role and gets the same table rules and the same derived status.

Every library action is one RPC, so a native client calls the same functions. Session actions take
the entry and the member's calendar day: `start_reading(entry, started_on)`, `finish_reading(entry,
ended_on, rating?, review?)` (#7); `abandon_reading` and `read_again` (#10), `update_session` and
`delete_session` (#11) slot in beside them (`finish_reading`, not `finish`: pgTAP owns `finish()`).
Refusals are stable `raise` messages the client maps to codes (`already_reading`, `not_reading`,
`date_in_future`, `ended_before_started`, `rating_invalid`, …; listed at the top of the migration).

## 5. Screens / Navigation

```
(auth)   Sign in (email) → Sign up (invite code; unknown email only) → Verify (six-digit code)
(tabs)   Home | Library | Search          avatar in the header → account, theme switch, sign out
         Home    → Currently reading, Up next, "Read in <year>: N"
         Library → Want to read / Currently reading / Finished (+ Not finished filter), Collections
         Search  → an overlay over the current page, never a page: one merged list, sources never shown
         any book → Book detail (cover, metadata, primary action, reading history, collections)
(sheets) Add · Finish · Abandon · Manual book · Collection picker
```

The visual design was decided in a prototyping round (#4: direction D "Night Reader", light and dark)
and ported as the design system (#5, docs/DESIGN.md); this spec fixes structure and behaviour only. Per-screen behaviour lives in [docs/parity.md](docs/parity.md).

## 6. Non-functional

- Offline: precached shell; the last-loaded Library readable offline; writes disabled and labelled
  "Offline"; search falls back to the Library. Writes are shaped so a queue can be added later inside
  the repositories.
- Speed: ~220 ms debounced search with aborts, thumbhash placeholders, preloaded first covers,
  keep-alive pages, navigation on pointer-down. Covers resolved once, cached by the service worker.
- Privacy: minimal data, EU region, no trackers. Keys never committed.

## 7. Milestones

Each is a `ready-for-agent` issue linking back to #1.

| # | Ticket | One line |
|---|---|---|
| [#2](https://github.com/fabkho/libellus/issues/2) | Repo scaffold | Nuxt PWA, tokens, local Supabase, CI, Pages — this skeleton |
| [#3](https://github.com/fabkho/libellus/issues/3) | Sign-in, tab shell | Invite code + six-digit code sign-up/sign-in, three empty tabs, sign-out |
| [#4](https://github.com/fabkho/libellus/issues/4) | Design prototyping round | Several genuinely different directions; Fabian picks one |
| [#5](https://github.com/fabkho/libellus/issues/5) | Port the picked design | The chosen direction becomes tokens and components |
| [#6](https://github.com/fabkho/libellus/issues/6) | Tracer | Find a book on Apple Books and put it on *Want to read* |
| [#7](https://github.com/fabkho/libellus/issues/7) | Start and finish | Start reading; finish with date, quarter-star rating, review |
| [#8](https://github.com/fabkho/libellus/issues/8) | Home | Currently reading, Up next, "Read in <year>" counter, empty state |
| [#9](https://github.com/fabkho/libellus/issues/9) | Add with any status | Log past reads directly as *Currently reading* or *Finished* |
| [#10](https://github.com/fabkho/libellus/issues/10) | Abandon and read again | DNF as a session ending; re-reads as new sessions |
| [#11](https://github.com/fabkho/libellus/issues/11) | Reading history and removing | Edit/delete sessions, remove from Library |
| [#12](https://github.com/fabkho/libellus/issues/12) | Full search | Catalogue + OpenLibrary, merging, dedupe, cover resolution |
| [#13](https://github.com/fabkho/libellus/issues/13) | Manual books | Typed-in books with generated placeholder covers, private |
| [#14](https://github.com/fabkho/libellus/issues/14) | Collections | Create, rename, delete, add, reorder, cover mosaic |
| [#15](https://github.com/fabkho/libellus/issues/15) | Offline and install | Persisted Library, offline labels, cover cache |
| [#16](https://github.com/fabkho/libellus/issues/16) | Core-loop E2E in CI | Playwright WebKit smoke of the loop on every PR; parity doc filled |
| [#17](https://github.com/fabkho/libellus/issues/17) | Fable import script | One-off, idempotent import of the Fable history |
| [#18](https://github.com/fabkho/libellus/issues/18) | Go-live | Hosted backend, production deploy, Fabian's account with his history |

After v1, roughly in order: page progress, Goodreads CSV import, German UI, offline write queue,
edition picker, Regal as a display layer, profile and stats, Google Books via an Edge Function, cover
upload and barcode scanning, quotes and notes, a custom domain, the native decision.

## 8. Decisions (settled 2026-10-02)

- **Supabase**, like Trappist; **Cloudflare Pages** for hosting.
- **One edition per Library entry**, no work level; a title + author match warns "other edition in
  your Library".
- **Exclusive status, non-exclusive Collections.** Status is derived from sessions, never written.
- **Re-reads and DNF are sessions**, not statuses. No "Paused".
- **Quarter-star ratings**, stored as integer quarters 1–20, optional.
- **English UI**, every string in the message file from day one.
- **Invite-gated email-code sign-in**, Trappist 1:1. No social.
- **Covers resolved once** on entering the Catalogue (Apple → OpenLibrary → placeholder), stored as
  URL + thumbhash.
- **Manual books stay private**, never in the Catalogue.
- **Search sources are invisible** (owner, #6): one field, one merged list; no source names, badges,
  counts or per-source loading. The source stays internal data on the Catalogue row.
- **One search row per book** (owner, #12): editions of the same title and first author collapse into
  one row showing the member's own edition, else the Catalogue's, else the device language's; ranked
  by how well the query matches title and author, then popularity. A specific edition is one ISBN
  search away.
- **Fable is imported once** by a local script, then dropped.

## 9. Testing

Seams exercised against a real local Supabase rather than mocks. A good test goes through a boundary
someone depends on and survives an internal refactor; fixtures are tagged per run so parallel runs
never clean up each other's data.

- **Database (primary)** — pgTAP in `supabase/tests/`. Invite gate, RLS, every data-model rule.
  Assertions act as a real signed-in member, never as the owner, and never count rows.
- **Web data layer** — Vitest in `web/tests/`, driving `web/app/data/` against the local stack;
  six-digit codes read from Mailpit.
- **Search** — recorded responses through an injectable `fetch`; live external APIs are never called
  in automated tests.
- **Fable import** — the pure mapping step, with fixture JSON.
- **User flows** — Playwright in `web/e2e/`, iPhone viewport in WebKit. With `docs/parity.md` the
  behavioural reference for a native port. Every interactive element carries
  `data-testid="<screen>.<element>"`, reused as the native accessibility identifier.
- **CI** — database + data layer, `nuxt generate`, generated-tokens check; Playwright joins with #16.

Not tested automatically: visual design, component snapshots, live external APIs.

## 10. Design

- [docs/DESIGN.md](docs/DESIGN.md) — the design guideline: direction D "Night Reader" (#4), its two
  themes and the theme rule, token roles, type, components, the runner-up directions.
- [docs/MOTION.md](docs/MOTION.md) — durations and curves from the tokens, the named motions.

## 11. Related repos

- `~/code/trappist` — the blueprint: stack, auth flow, testing setup, design process.
- `~/code/regal` — cover resolver and Apple Books lookup; Goodreads and reading-tracker parsing.
- `~/code/reading-tracker-cli` — schema with sessions, shelves, DNF; source of the Fable export.
- `~/code/betterreads` — domain and UX ideas only; its Flutter stack is not reused.
- NuxtBooks — search and navigation speed patterns.
