# The Book page's hero — three answers to the pile

What sits between the cover and the first action button on the Book page (`web/app/pages/book/[key].vue`) is,
today, four stacked centred rows of small quiet text: the facts (year · pages · publisher), the genre chips with
a quiet **Edit**, the Goodreads figures with a quiet **on Goodreads**, and the links with a quiet **More** — each
with its own dot-separated list and its own little text button. That is what these three mocks rearrange.

The owner's constraint for this round: **the genres and the Goodreads data stay in the hero in every variant.** None
of the three moves them down into About. What changes between them is how much else shares their space, and what
kind of object that space is. Everything else is fixed in all three: the cover, the title, the author and the series
line are untouched (the owner said they are fine); the status line, the progress block and the one filled action keep
their places under the pile; About, its text, the edition line and the Notes / Read together pair keep theirs.

Two things do move out of the hero in all three, because they were pure repetition or pure furniture:

- **The publisher.** The facts row stops saying it: the edition line under About already says "This edition: Fleet,
  2024". One less item in the pile, and no information lost.
- **The underlined micro-buttons.** **Edit** sat on the chip row's second line at 390 px (three pills plus a word do
  not fit); **More** was a dot-separated link inside the links' own run. The pills themselves become the way into the
  genres sheet — a tap anywhere on the row, and the sheet it opens is unchanged — and the links move behind the **⋯**
  in the top bar, which already opens a sheet of the Book's own things (Share, Hide, Change edition, Series, the
  ebook). In `v1` and `v2` that ⋯ carries a small lamp dot while links are behind it, so nothing is hidden unmarked;
  `v3` keeps the links in the hero and has no mark.

Shots are in `docs/images/book-detail/` — dark 390 EN, dark 360 DE, and every state panel at 390 EN. Dark is the only
room these are shot in: the owner judged this round in dark alone, so `node shoot.cjs` writes dark and nothing else.

---

## v1 — the strip

**The idea:** the four rows become one hairline group in the language the page already uses for the Notes / Read
together pair — a surface in `fill`, a half-pixel hairline ring, a hairline between its rows. **Moves:** the genres
keep their pills and become the group's first row (the row is the button that opens the genres sheet); the year, the
pages and the format become one faint mono line, the Goodreads figure with its two counts a second one under it,
dot-separated, the average
in `inkMuted` and its counts in `inkFaint`. The publisher goes to the edition line; the links to the ⋯ sheet.
**Gains:** a clear edge — the eye sees *one* object under the series line instead of four loose rows, and the status
line under it then reads as the start of the reading part of the page. The pills are the only thing with height, so
genre recognition is instant, and Goodreads is a single scannable line. **Loses:** the average, the two counts and
the Goodreads link are one dense dot-separated run, so a member who came for "6.1K reviews" has to scan a
sentence-shaped line rather than find the figure on its own row;
and the links are one tap further away than today. **Risk:** a filled box in a hero that is otherwise hairlines and
type can read as a card the page did not need, and it is the same shape as the Notes / Read together box further down.

## v2 — the number leads

**The idea:** no box and no pills — type alone, with one figure the eye lands on. **Moves:** Goodreads stops being a
metadata row and becomes the hero's second focal point: **4.3★** set as a figure (mono, 24, light, tabular), its two
counts in a faint mono line under it with `on Goodreads` as the one link; then the genres as a single line of words in
ink; then the year, the pages and the format as the last and faintest mono line. The publisher goes to the edition
line; the links to the ⋯ sheet; the genres' sheet opens from the ⋯ too. **Gains:** hierarchy, unmistakably — figure,
then community, then what the book *is*, then its facts, in a scale that descends the way interest does. It is the
calmest of the three and the shortest vertically, and it is the only one where the Goodreads number is big enough to
read at arm's length. **Loses:** the genres stop being three separable, tappable things and become a sentence
fragment, so the eye must read instead of scan; the way into the genres sheet is now the ⋯, one tap further from the
word it edits. **Risk:** it makes the *community's* opinion the loudest thing after the title, on a page whose whole
purpose is the member's own reading — the owner asked for less noise about ratings, and this makes one of them a
headline.

## v3 — two things and a door

**The idea:** the hero keeps exactly the two things the owner wants — the genre pills and the Goodreads figure — and
everything else waits behind one quiet **Details**. **Moves:** the chips are the first row (the row opens the genres
sheet); the second row is one faint mono run, **4.3★ · 138K ratings**, ending in a **Details ⌄** button. That button
opens a hairline group in place (the pair's shape once more) holding the year, the pages, the format, the two
Goodreads counts with their link, and the Book's links. Closed by default; `STATE A2` is the same Book open.
**Gains:** the worst case (State A, everything present) is as short as the sparsest one, so the progress block and the
action sit high on the page on every Book — that is the owner's actual complaint answered directly. Nothing is lost,
only deferred, and the door is a word, not an icon. **Loses:** the year and the counts are now one tap from the first
look, and a member who wants the year will not know it is there unless she opens the door. **Risk:** a second fold on a
page whose hero was already called cluttered can read as the app hiding what it knows; and if the block does not
remember being open, it costs her a tap on every visit.

---

## What the current hero already does that the pile hides

The status line is not part of the metadata pile, and it already carries the member's own rating: on a rated Book the
app draws the stars *in the status line*, before the word "Finished". So "the ratings row of my own rating" in the
complaint is a different problem from the four metadata rows — her stars sit in a line that also says the status and
the date, so they read as decoration rather than as a rating. All three mocks leave that line exactly as it is (it is
shown with four stars in every State A and State B panel); if the owner wants her rating to read as a rating, it
should come out of the status line into something of its own, which is a separate decision from this one.
