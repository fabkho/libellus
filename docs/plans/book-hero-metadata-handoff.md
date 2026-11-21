# Task: implement the Book page's metadata block from the settled mock

## Why

The Book page (`web/app/pages/book/[key].vue`) stacks four centred rows of small quiet text under the title: the
facts, the genres, the Goodreads figures, and the links. The owner called it a pile and rejected eleven mocks
over four rounds. He settled on **m5** — heap them out of the hero, group what describes the copy under About.

The mock is final. **Do not redesign it.** If something in it is impossible, say so in the report and stop
rather than inventing a different layout.

Read, in this order:

1. `docs/prototypes/book-detail/m5.html` — the settled mock, one `<style>` block at the top, four panels (A, B,
   F, C). Its own comments say what each rule is for.
2. `docs/plans/book-hero-metadata.md` — the implementation plan: exact deletions, the five cells, the spacing
   table, the new i18n keys, and the e2e cost spelled out line by line. **This is your spec.**
3. `docs/prototypes/book-detail/README.md` — only if you want the reasoning behind what was rejected.
4. Shots: `docs/images/book-metadata/m5-*.jpg` (dark). `m5-dark-en.jpg` is the target, `m5-b-dark-en.jpg` is the
   long-About-with-More case, `m5-c-dark-en.jpg` is a Book with no description. Look at two at most.

## The shape of the change

**Hero:** keeps the cover, title, author, series, the genre pills and the Goodreads row — and nothing else. The
facts row and `BookLinks` leave it. `BookGenres` and `BookGoodreads` keep their place and their reserved heights.

**Under About:** a new `web/app/components/book/Meta.vue` draws a two-column grid, no box and no hairline, of
name over value: `First published` / year, `This edition` / publisher + year, `Format`, `Pages`, and the Book's
links on a full-width last row with **no label** (the owner explicitly rejected "Elsewhere") and dots between
them that wrap. It replaces the current `<p data-testid="book.thisEdition">`, which sits *outside* the About
section so a Book without a description still has an edition line — that case is the mock's panel C and it must
keep working.

**Spacing:** 48 above the About section, 16 between the About text (or its **More** button) and the grid, 32
between the grid and the Notes / Read together pair. The **More** button's own 44 px touch height is the gap when
it is there, so About → grid is 16 px both with and without it. All of it in the plan's table, in tokens.

## Rules

- **The i18n keys are in the plan** (five of them, en + de). Use `book.thisEdition`'s parts as the values for
  cell 2 — do not add a `This edition:` sentence next to a `This edition` label.
- **Never edit an applied migration, and touch nothing in `supabase/`.** This is a page layout change: no
  migration, no schema snapshot, no db push.
- **`utils/publishedYear.ts` is not yours to change.** `editionLine`'s suppression rule (no line when the work's
  year and the copy's year agree) is pinned by unit tests and two e2e specs. Read the plan's paragraph on it.
- **The e2e specs are the work, not a nuisance.** Five specs assert `book.facts`, which you are deleting. The
  plan lists each file and line and what it must assert instead. Update them in the same commit; a green unit
  suite with a red `first-published.spec.ts` is an unfinished task. `web/e2e/bookOpenFlows.ts` also compares the
  hero's boxes before and after the Book's answer lands — the hero must not move.
- Language is on every Book and the mock shows it. **Do not add it** in this PR (the plan says why). The owner
  asked and was told it is out of scope here.
- Dark only. Do not shoot light-theme mocks; there are none.

## Done means

- `pnpm test:unit`, `pnpm test:components` green; `pnpm exec playwright test e2e/first-published.spec.ts
  e2e/bookOpenFlows.ts e2e/google-books.spec.ts e2e/search-and-add.spec.ts` green against the local stack, or a
  precise account of what did not run and why. `pnpm build` clean.
- `docs/parity.md`'s Book page section mentions the block in one sentence.
- One commit, `feat(book): the metadata piles out of the hero and under About`, and a PR. Do not merge it, do not
  force-push, do not push to `main`.
- In the report: the commit, the PR URL, the gate results as a table, and the three things you had to decide
  that the plan did not decide for you.

## Report under 400 words.

Mocks are documentation. `docs/prototypes/book-detail/` and `docs/images/book-metadata/` are the settled record
of the four rounds — commit them **with** the implementation if they are still uncommitted in your checkout
(the current branch has them uncommitted, and `docs/images/book-detail/` holds deletions of the rejected set).
