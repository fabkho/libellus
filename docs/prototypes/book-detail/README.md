# The Book page's hero, and three answers for the metadata under About

The hero is settled: **the genre pills and the Goodreads row, and nothing else.** Everything that describes the
copy — when the work was first published, when this edition was printed, which format it is, how long it is, and
the Book's own links — now sits under About, in the line that was already saying the edition. What is left above
the status line is only what is about *this reading*.

That was the owner's call after four rounds: v1 (a hairline strip), v2 (the average as a headline figure) and v3
(the metadata behind a **Details** door) all lost to v4-a, which is this header. So this folder is now about the
one thing still open: **how the metadata block under About reads.**

Two things leave the header for good in every variant here:

- **The publisher.** The edition line already names it.
- **The year, the page count and the format.** They move under About, where the copy is described. The page count
  was the last orphan in the header — it sat under the Goodreads row with nothing to bind it to, and on a Book
  being read the same 416 is in the progress block two lines down.

Shots are in `docs/images/book-metadata/` — dark 390 EN, dark 360 DE, and every state panel at 390 EN (A, B, F,
and C, the Book with no description yet). Dark is the only room these are shot in: the owner judged this round in
dark alone, so `node shoot.cjs` writes dark and nothing else. `STATE C` matters because the app draws the
edition line *outside* the About section when a Book has no description, so the block has to stand alone too.

---

## m1 — the index

**The idea:** one row per fact, its name on the left in the page's micro-caps, its value on the right, a hairline
between the rows — the shape of a colophon. **Moves:** nothing but placement; the five facts and the two links are
the same ones in all three. **Gains:** the fastest of the three to scan for one number, because "Pages" is where a
list's fifth row is, and the block reads as a list of the copy rather than as prose. **Loses:** five rows of
hairlines under an About paragraph is a lot of rules on a page that already draws a box and a hairline under it;
and a two-value-per-line label column is the densest thing on the screen. **Risk:** it can read as a settings
screen — a table of properties — where the page is trying to be a book.

## m2 — the spec strip

**The idea:** the same five facts as one row of cells divided by hairlines, each value in the readable ink with its
name under it in micro-caps. No box, no rows. **Moves:** values first, names second, so the eye lands on `2023 ·
Fleet, 2024 · hardcover · 416` and only reads the names if it needs them. **Gains:** the shortest of the three and
the only one that never wraps at 360 px, since every cell is a fixed column; it stays a strip of type, which is the
language the hero above it now speaks. **Loses:** five cells across a phone is tight, and the last one (the two
links) is wider than the rest, so the dividers are not evenly spaced. **Risk:** at 360 px in German the cells crowd
— `ERSTMALS ERSCHIENEN` is much wider than `FIRST PUBLISHED`, and the strip has no room left to give.

## m3 — the shelf card

**The idea:** the same facts in one filled box on the pair's own terms — the fill, the radius, the half-pixel
hairline — a two-column grid of name over value, the links on their own row last. **Moves:** only the container;
the values are the same. **Gains:** the easiest to find when the eye comes back down the page for one number, and
it groups the copy's facts the way the Notes / Read together pair below it groups her own — the page's one existing
language for "a set of things". **Loses:** it is a second box on a page that already has one, which is the
criticism that killed v1's strip; and a filled block under a text paragraph can look like a footer of chips.
**Risk:** the box competes with the pair directly under it, and two boxes with the same radius and fill, a few
lines apart, is exactly the "card the page did not need" the owner disliked in v1.

---

## What the current hero already does that the pile hides

The status line is not part of the metadata, and it already carries the member's own rating: on a rated Book the
app draws the stars *in the status line*, before the word "Finished". All three variants leave that line exactly as
it is. If the owner wants her rating to read as a rating, it should come out of the status line into something of
its own, which is a separate decision from this one.
