# Your shelf for everyone

Owner's words: "opening up the 3D stack for all accounts, so each one gets one, and we just take the
most common colour from the book cover and print and colour the spine and the back in the same
colour so it's one colour." The last open item before friends are invited. Related: #214 (the
shelf needs love; this does the reachability and the free-tier part of it, not the parity with the
portfolio's `app` mode).

## What changes

**Who.** Every signed-in member in a build with Regal (`LIBELLUS_REGAL=1`) has Your shelf: the
Profile's row, the full Stack (`/profile/shelf`), the year in review's row and the owner-only row in
Home's *Read in* sheet. The build flag still decides whether the build has Regal at all; without it
nothing changes for anybody. `stores/shelf.ts` `isOwner` becomes `available`.

**Whose Books.** Each member's own Library, built on the device from the Library the app already
keeps (`stores/library.ts`, the device copy: offline too). Nothing is fetched from R2 and nothing is
written anywhere: a member's shelf is never published, never public. The public reading pages
(`/r/<token>`, the `regal` kind) stay as they are.

**The owner** keeps the published file (`books.fabkho.dev/v2/library.json`) in Libellus, unchanged:
it is what his portfolio and his reading page show (the paid Spine and back art), it is the file the
`shelf_publish` chain writes, and keeping it means his Libellus shelf and his portfolio are one shelf.
Everybody else gets the member mode. (One line to flip later if he wants the flat look himself.)

**One colour per Book (the owner's rule).** Spine and back are one flat colour, the cover's most
common colour (`books.cover_dominant`); without it the thumbhash's average; without a cover (or a
Placeholder cover) the Placeholder's cloth for the title (`clothOf`, tokens `cloth1…6`). Guard rails
(`web/app/utils/bookColour.ts`, pure, unit-tested on pure white, pure black, grey, neon and real-looking
covers): saturation capped, lightness kept in a band, and then nudged out of the middle band where
neither ink reads, so the ink (Regal's ink `#2C2C2A` or paper `#F5F2EB`, whichever has the higher WCAG
contrast) always has at least 4.5:1. The front stays the real cover.

**Regal** (fabkho/regal, its own PR, backwards compatible: the portfolio's file has no `color` and
draws exactly as before):

1. `assets.color` (`#rrggbb`) on a Book of the library file: the Book's one colour. With it (and no
   Spine/back art), the Spine and the back are drawn flat in that colour: title and author along
   the Spine, a quiet title block on the back, ink by WCAG contrast. Page edges' boards take it too.
2. Procedural and lazy: no files. A flat Book starts as a 2 × 2 canvas in its colour; its typeset
   Spine is drawn only for Books in the Stack's load window (in and near the view) and dropped
   again when the view has moved far away, so texture memory follows the view, not the Library.
   A flat Book's front loads only when it shows (the top Book, a Book taken out), not as
   background fill. The back is drawn for a Book taken out (as today).
3. An in-memory library: `RegalBooksStage` / `RegalBooksRow` take `library` (a library document
   object) instead of a URL; `preloadRegal({ library })` warms from it. Validated with the same
   validator; images must be absolute URLs.
4. Size from pages and binding, hover, pull-out, turn, the Stack and the Row: unchanged.

**Libellus:**

1. `data/shelf/` gets the member source: the Library lists → `RegalExportEntry` →
   `exportRegalLibrary` (reused, not forked; finished and Currently reading Books) → `assets.color`
   from `bookColour`, `assets.front` from the cover, `pile.front` a small Apple Books copy where the
   URL allows it.
2. `stores/shelf.ts`: `available` (Regal in the build), `source` (`published` for the owner with a
   library file, else `member`), `document` (member) or the fetched file (owner).
3. `ShelfStage`, `ShelfRow`, `ShelfRowCard`, the warm-up pass the document through.
4. Gates removed: the shelf page's `validate`, the Profile section's mount, Home's *Read in* sheet,
   the year page's row. A member with no read Books sees a calm empty state (the lamp over the empty
   shelf) instead of an empty room.
5. Offline: the Stack works from the device's Library; without the `regal` chunk cached, a quiet
   message (`shelf.offline`), no crash.

## Privacy

Nothing new is stored or sent: the shelf is computed on the device from what the device already
holds; covers are fetched from the same hosts the app already shows them from. No table, no function,
no migration. The privacy notice (PR #281) needs no sentence.

## Proof and numbers

- Vitest: the colour rule; the member document (shape, validator, statuses, colours).
- Regal: `pnpm test` (flat faces, the in-memory source, the validator's `color`).
- Perf (`web/perf`, a 1,000-entry seed): time to first draw, long frames, frame cost while
  scrolling, JS heap and texture memory of the Stack; the chunk stays lazy and out of the precache.
- Playwright script (tagged, outside the default run): a member with ~40 and with 1,000 Books at
  390 × 844: the loading pile, the Stack, a Book out (front, back, spine), the empty state;
  screenshots and a short video in `/tmp/shelf-for-everyone/` and `.shots/`; a contact sheet of the
  colour rule before/after on 12 covers.

## Order

Regal PR first (merged by the coordinator), then the Libellus PR bumps the Regal ref: its CI cannot
pass against the old Regal main until then.
