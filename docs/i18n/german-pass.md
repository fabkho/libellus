# The German pass

`web/e2e/i18n/german-pass.spec.ts` sets the app to German (a phone in `de-DE`, nothing chosen), signs in a seeded member (a Library with a Book in every state, three friends and a request, reviews, genres) and walks the main journeys: sign-in, sign-up with an invite error, the privacy notice, Home empty and full (all sections, the friends rows, the Read-in sheet), search (palette, results, offline), the Library (three segments, the view bar, the sort and filter sheets), a Book being read, wanted and finished (options, Update progress, Finish, Start, Change edition, Add), Collections, the Profile (every row, the Contact, Name, Book links, Privacy and follow-link sheets, a year in review), the feed, People (requests, following, the member sheet), the shelf (with the Regal layer), the import page, an offline error, and the Language row switched to English and back. Each screen is shot at **390 × 844** and **360 × 780**, in **light and dark**: 47 screens × 4 = 188 screenshots.

For every screen it checks that the document does not scroll sideways (the check the other flows make), records every element whose text is cut off (an ellipsis or a line clamp wider or taller than its box, or a control with hidden overflow; the member's own words are left out) and every visible text that is still an English string of `en.json`. Run it on a throwaway stack, by hand (it is outside the default run: `LIBELLUS_E2E_GERMAN=1`):

```sh
LIBELLUS_E2E_GERMAN=1 LIBELLUS_E2E_PORT=3104 GERMAN_PASS_OUT=/tmp/german-pass pnpm exec playwright test e2e/i18n --workers=1
# the shelf screen needs a build with the Regal layer: LIBELLUS_REGAL=1 REGAL_LAYER=<a checkout of fabkho/regal>
```

Screenshots and `findings.jsonl` land in `GERMAN_PASS_OUT` (default `/tmp/german-pass`); the worktree's `.shots/` is git-ignored.

## What it found, and what was done

First run: **13 findings** (the scan found nine, the screenshots four more). Every one that is German's fault is fixed with a shorter or a better German word, none with CSS; the fix is a new `de.json` value, reviewed like the rest (the key's English in the middle column).

| # | Screen | Element | English | German before | German now (fix) |
| --- | --- | --- | --- | --- | --- |
| 1 | Home, the reading card (390 and 360) | `home.progress`, cut with "…" | Not started yet (`book.progress.none`) | Noch nicht begonnen | **Noch offen** |
| 2 | Profile, the figures (390, 360) | the line under Days a book, cut | usually, start to finish (`profile.figures.usually`) | meistens, von Anfang bis Ende | **meist Start bis Ende** |
| 3 | The Add sheet's title (390, 360) | `add.sheetTitle`, cut | Add to Library (`add.title`) | Zur Bibliothek hinzufügen | **Zur Bibliothek** (the buttons keep the long form) |
| 4 | The Update progress sheet's title (390 by eye, 360 by scan) | `progress.sheetTitle`, cut | Update progress (`book.progress.title`) | Fortschritt aktualisieren | **Fortschritt** (the button keeps the long form) |
| 5 | Home's friends row and the request line (360) | the line under the name, cut | asked to follow you (`friends.askedLine`) | möchte dir folgen | **will dir folgen** |
| 6 | People, requests (360) | the line under the name, cut | asked {when} (`people.askedOn`) | angefragt {when} ("angefragt jetzt") | **Anfrage {when}** |
| 7 | The Library's view bar (360) | the count, cut to "1 B…" by a long Sort pill | Date added (`library.view.sortKey.dateAdded`) | Sortieren: Hinzugefügt am | **Sortieren: Hinzugefügt** (the count fits again) |
| 8 | The Finish sheet (by eye) | the summary line: ungrammatical | Read in {days} · {perDay} (`book.progress.readIn`) | "Gelesen in 3 Tage" | **Lesedauer: 3 Tage · …** (a plural cannot take the case a preposition asks) |
| 9 | The Finish sheet, the Update sheet, Home (by eye) | the pace lines | {count} a day (`book.progress.perDay`, `…perDayPercent`, `…readPerDayPages`) | … am Tag | **… pro Tag** |
| 10 | The Library's filter sheet (by eye) | the status chip for a DNF | Not finished (`library.view.status.notFinished`) | Nicht gelesen (wrong: it is a read that was put down) | **Abgebrochen** |
| 11 | The Update progress sheet (by eye) | the DNF button beside the sheet's own Cancel | DNF (`book.abandon`) | Abbrechen (two Abbrechen on one sheet: one cancels the sheet, the other ends the read) | **Weglegen** |
| 12 | The shelf (Regal's own text) | a span on the Book's back | not rated | the layer's own English: no key of ours | **not fixed**: Regal's strings are the private layer's (fabkho/regal), outside this repository |
| 13 | Profile, the figures, **in English** at 360 | the same line as #2 | usually, start to finish | (English) | **not fixed**: English truncates at 360 (158 px of text in a 144 px box) and did before German; a shorter English line, or letting it wrap, is the owner's call |

Not findings: `libellus.test` cut in the edition sheet (the test fixtures' publisher, member data), and the member's own words (titles, authors, the e-mail as the Profile's title) which are never judged.

After the fixes the scan finds nothing German's fault at 390 or 360 in either theme: the remaining rows are #12 and #13. Screens where nothing was found are in the screenshots too: the tab bar (three icons, no labels), the sheets' titles and actions (Abbrechen · Titel · Speichern fit in one line at 360), the segmented controls (*Möchte ich lesen · Lese ich · Gelesen* with their counts), the chips of the filter sheet, the profile hero's library line (it wraps to two lines by design) and every top bar.

## What it cannot see

- **Meaning and grammar.** The scan finds cut-off and English text; #8, #10 and #11 were found by reading the screenshots. A second reader of the screens is still worth an hour (docs/i18n/german-review.md).
- **Plurals and cases that the seeded data does not reach** (a count of 0 or 2 in a place the seed has 1 or 3), the Android and iOS system keyboards, a long member name, a very long book title (data, truncated by design), text-size settings of the system, and Regal's own English.
- **What a member's phone shows that Playwright's WebKit does not**: the iOS date picker's own language follows the phone, not the app (the browser's native `<input type="date">`).
- **The emails, the function messages, the PWA manifest and the offline page**: group B of issue #257, not started.
