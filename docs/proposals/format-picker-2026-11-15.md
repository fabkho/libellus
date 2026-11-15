# The two format pickers: are they one thing?

Assessment, 15 November 2026. No code, no migration. The owner's question: the ⋮ menu on the Book page
has a physical / ebook / audiobook select, and Change edition has another one (hardcover / paperback /
ebook / audiobook) — why both, and can one go?

Short answer: **they are not the same control and they do not write the same thing.** What he is seeing
is one shared look (`UiIconSegments`) on two different facts. Removing either would lose a function.
The detail is below; the recommendation is in §5.

## 1. The two controls, exactly

There is **no format select in the ⋮ menu**. What looks like one is **Read as**. The owner's premise is
half a step off, and that matters: the two controls do not even offer the same choices.

### Control A — the ⋮ menu: Read as (how she read it)

- Rendered: `web/app/components/book/ReadAs.vue`, mounted once in the options sheet at
  `web/app/components/book/OptionsSheet.vue:159` (`testid="bookOptions.readAs"`), and again in the
  Finish sheet at `web/app/components/book/FinishSheet.vue:94` (`testid="finish.readAs"`, sent with
  the finish instead of saved). Deliberately **not** on the Book page itself
  (`web/app/pages/book/[key].vue:21`, `docs/parity.md:239`: the page keeps to its one action).
- Choices: three segments — **physical, ebook, audiobook** (`readAsOf`, `READ_AS` in
  `web/app/data/readAs.ts`). No hardcover/paperback split: it does not say what the edition *is*.
- Write path: `ReadAs.vue` → `library.setReadAs` (`web/app/stores/library.ts:369-372`) →
  `repo.setReadAs` (`web/app/data/library.ts:1126-1128`) → RPC `set_read_as` →
  **`library_entries.read_as`**. Null clears it (`supabase/migrations/20261011020000_read_as.sql:25`).
- Meaning: **how she read this Book** — hers, not the edition's. "A word she never said stays unsaid":
  `readAs.ts:1-17` says so explicitly, and "not to be confused with an edition's *format*".
  Where she never said, the edition's format is only the *display default* (`readAsOf`,
  `web/app/data/readAs.ts:57-62`), never stored.

### Control B — the change-edition flow: format of the copy (what the edition is)

- Rendered: `web/app/components/book/FormatChoice.vue`, in three places —
  `web/app/components/book/EditionSheet.vue:118` (`testid="edition.format"`, label
  "Format of your copy", `book.edition.copyFormat`) and twice in
  `web/app/components/book/OwnEditionSheet.vue:200` (`ownEdition.foundFormat`, the found edition)
  and `:226` (`ownEdition.format`, required, her own edition).
- Choices: four segments — **hardcover, paperback, ebook, audiobook** (`BOOK_FORMATS`,
  `web/app/data/books.ts`; `FormatChoice.vue:1-11`).
- Write paths (all end in **`library_entries.format_override`**, never in the shared Book):
  - Own edition picked, "Save": `edition.setFormat` (`web/app/stores/edition.ts:304-308`) →
    `repo.setFormat` (`web/app/data/library.ts:1085-1091`) → RPC `set_entry_format` →
    `format_override` (`supabase/migrations/20261011090000_own_edition.sql:297-312`).
  - Another edition picked, "Change & save": `edition.confirm`
    (`web/app/stores/edition.ts:257-260`) → `changeTo(entry, book, format)` → RPC
    `change_edition(p_format)` → `format_override`
    (`20261011090000_own_edition.sql:227`, same migration's header: "`change_edition(p_entry_id,
    p_book, p_format)` — #41's, with the format she picked for it").
  - "My edition isn't listed" (found or own): `own.useFound` / `own.saveOwn`
    (`web/app/stores/ownEdition.ts:200-247`) route into the same two calls above; the own-edition
    form additionally creates her private Manual book, whose `books.format` is set at creation —
    the **only** member-driven write to any `books.format`, and it is a new private row, never an
    edit of a shared one.
- Meaning: **what her copy is** — her word on the edition's format, stored as the override, with
  "equal to the Book's format stored as none, so it follows the Book"
  (`20261011090000_own_edition.sql:29-33`). The format that counts everywhere (Book page facts,
  `web/app/pages/book/[key].vue:165`) is `formatOf(book, entry.formatOverride)` =
  `coalesce(format_override, books.format)` (`web/app/data/books.ts:110-111`).
- **Nothing a member taps writes `books.format` on a shared Catalogue Book.** `books.format` is
  what the source said (Apple's are ebooks, OpenLibrary's `physical_format` is read;
  `20261011090000_own_edition.sql:60-63`), kept with the first snapshot. The migration header says
  it outright: "A Catalogue Book is shared, so the member's correction is never written into it:
  it is her entry's `format_override`, private like the rest of her entry."

So, plainly, as asked:

| | ⋮ menu (Read as) | Change-edition flow (Format) |
|---|---|---|
| Writes | `library_entries.read_as` (`data/library.ts:1126`) | `library_entries.format_override` (`data/library.ts:1085`, via `set_entry_format` / `change_edition p_format`) |
| Writes `books.format`? | No | No — except creating her own private Manual edition |
| Means | "I read it on paper" | "My copy is a paperback" |
| Choices | physical / ebook / audiobook | hardcover / paperback / ebook / audiobook |

## 2. Why each exists

- **Read as exists because the edition cannot say how she read.** Issue #169, shipped 7 Oct 2026
  (`b3093ad4` "filter and sort the Library and say how each book was read"; DB `read_as` +
  `set_read_as`). An ebook edition picked for its cover does not make it an ebook read
  (`20261011020000_read_as.sql:13-23`). It drives the Library's Read as filter and facet counts
  (`web/app/data/libraryView.ts:168,270`) and is preset on change-of-edition from the new edition's
  format only where she already had a word and the new edition is read another way
  (`supabase/migrations/20261014020000_change_edition_read_as.sql:55-72`; `web/tests/read-as.test.ts:85-133`).
  History sharpened its placement: on 7 Oct it was given the same segment control as the format row
  (`ff78a2de`, "so the two rows look and behave alike" — the visual confusion starts here), and on
  8 Oct it was taken off the Book page into the options sheet only (`4a7eb4dc`, owner: "the page
  carries one action; the options sheet is enough"). `docs/parity.md:405-412` is its contract.
- **The format row exists because sources do not say print-vs-ebook reliably, and she wants it
  right.** Same week, the companion commit `cb027777` ("keep a Book's format, her own format and
  her own edition"): "Sources say little about whether an edition is printed or not … and the
  member wants physical against ebook right." It is her word *about the edition*, shown back in the
  Book page facts (`[key].vue:165`), the edition rows (`EditionPicker.vue:67-68`), and the shelf
  binding (`data/memberShelf.ts:193-197`). `docs/parity.md:1198-1205` is its contract.
- Neither can serve the other: Read as has no hardcover/paperback (it is not about the object) and
  never touches the facts row; the format row has no notion of "how read" and never touches the
  filter. The one functional bridge — change-of-edition presetting Read as — runs *between* them
  precisely because they are different columns.
