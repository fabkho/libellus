# Design playground — for direction authors

`/prototype` shows Libellus' screens in iPhone-sized frames (393 × 852) so Fabian can pick a
visual direction (issue #4). The playground is **dev only**: `nuxt.config.ts` strips every
`/prototype*` route from production builds, and nothing outside the page imports
`components/proto/`, so none of it reaches the app.

You build **one direction** in **one folder**. The shell, the screen list and the sample data are
shared; you never edit them.

```
components/proto/
  contract.ts        Direction / Toggle types, the screen list, useProto(), withProps()
  data.ts            sample data: Fabian's real books (typed with the glossary's words)
  registry.ts        finds directions/*/index.ts by glob
  proto.css          the playground's own Tailwind (default theme, not the app's tokens)
  shell/             Frame (phone + status bar), NotBuilt placeholder
  directions/
    ref/             "Wireframe": every screen, grey, the template to copy
    <yours>/         index.ts + whatever you need
pages/prototype.vue  the page: header, gallery, Vergleich
scripts/proto-shots.mjs   PNGs of every frame
scripts/proto-font.mjs    fonts into your folder
```

## Run it

```sh
cd web
./node_modules/.bin/nuxt dev --port 3022     # any free port; no Supabase, no .env needed for /prototype
open http://localhost:3022/prototype
```

Every selection lives in the query, so a link reproduces the view:

| Query | Meaning |
|---|---|
| `d=a` | direction in the gallery (default: the first that isn't `ref`) |
| `g=book` | only one screen group (`start`, `home`, `search`, `book`, `library`, `collections`) |
| `mode=vergleich&s=home` | Vergleich: screen `home` once per direction, side by side |
| `a.palette=dusk` | toggle `palette` of direction `a` (defaults are left out of the URL) |

## Add a direction

```sh
cp -r app/components/proto/directions/ref app/components/proto/directions/a
```

Then in `directions/a/index.ts` set `key: 'a'` (must match the folder), `title`, `summary`, your
`toggles`, and restyle the screens. Delete the wireframe's `Note` annotations and `ref.css`
(replace it with your own, see Scoping). The folder appears in the header on the next reload; no
other file changes.

### The contract (`contract.ts`)

```ts
export default defineDirection({
  key: 'a',                       // = folder name
  title: 'Books',                 // short, shown in the header
  summary: 'One paragraph: the idea.',   // shown above the gallery
  toggles: [                      // optional live switches in the header
    {
      key: 'palette',             // lower-case, no dots; URL `a.palette=…`, frame attribute `data-palette`
      label: 'Palette',
      options: [{ value: 'day', label: 'Day' }, { value: 'dusk', label: 'Dusk' }],
      default: 'day',
    },
  ],
  screens: {                      // Partial<Record<ScreenKey, Component>>; missing keys show "Not built"
    home: Home,
    'library-want': withProps(Library, { status: 'want_to_read' }),   // one component, several keys
  },
})
```

Toggle keys `direction`, `screen` and `built` are taken by the frame.

### What a screen gets: `useProto()` (provide/inject)

Screens get **no props from the shell**. Each frame provides a context; read it anywhere in your
direction (screen or kit component):

```ts
import { useProto } from '../../../contract'

const proto = useProto()          // ComputedRef<ProtoContext>
proto.value.toggles.palette       // 'dusk' — current values of *your* toggles, defaults filled in
proto.value.data.reading          // sample data, see below
proto.value.screen                // the screen key this frame shows
proto.value.direction             // your Direction object
```

In templates the ref unwraps: `{{ proto.data.member.initials }}`. It is reactive: switching a
toggle re-renders the frame. Toggles are also on the frame as `data-<toggle>` attributes, so
plain CSS can switch on them (below).

## Scoping rules

Four directions render on one page (Vergleich puts them side by side), next to the app's own
CSS. Nothing may leak.

- **Your CSS variables** go on `[data-direction='<key>']` — the phone screen element `Frame.vue`
  renders. Prefix them with your key (`--a-paper`, `--a-ink`). Every selector in your CSS files
  starts with `[data-direction='<key>']`; switch on toggles with
  `[data-direction='a'][data-palette='dusk'] { … }`. Import the CSS file from your `index.ts`.
- `<style scoped>` in your components is fine and needs no prefix.
- **No global CSS**: no `:root`, `html`, `body`, bare element or unprefixed class selectors, no
  `@import 'tailwindcss'`, nothing in `assets/css/`. Never redefine the app's tokens
  (`--color-*`, `--font-sans`, …).
- **Frame variables** you may set on your root: `--screen-background`, `--status-bar-ink` (status
  bar colour), `--home-indicator`. Read-only: `--safe-top` (59px, under the notch), `--safe-bottom`
  (34px, the home indicator), `--frame-width`, `--frame-height`. Pad with these, not `env()` (which
  is 0 on a desktop).
- `position: fixed` inside a screen pins to the phone, not the window — use it for tab bars and
  sheets, or `absolute` against your screen root as the wireframe does. The screen is a still
  frame: content that doesn't fit is cut off, so put what matters first.
- **Tailwind**: the playground has its own Tailwind (`proto.css`) with the **default** theme
  (`neutral-*`, `rounded-xl`, `text-[17px]`, …). The app's token utilities (`bg-surface`,
  `text-ink`) do **not** exist here. Use your variables through Tailwind's arbitrary values —
  `bg-(--a-paper)`, `text-(--a-ink)`, `font-(family-name:--a-serif)` — or plain scoped CSS. After
  using a class nobody used before, `touch app/components/proto/proto.css`.
- **Fonts** live in your folder, never in `package.json` (four agents, one lockfile):

  ```sh
  node scripts/proto-font.mjs fraunces app/components/proto/directions/a --weights 400,600 --italic
  ```

  writes `directions/a/fonts/*.woff2` + `fonts/fraunces.css` (latin subset, from Fontsource);
  `import './fonts/fraunces.css'` in `index.ts` and use the family name it prints, only inside your
  scope. Font ids are the ones on fontsource.org.
- **Don't edit outside your folder**: not the shell, `contract.ts`, `data.ts`, `registry.ts`,
  `proto.css`, the page, another direction, or anything in the app. If the shared parts lack
  something, ask the coordinator.
- Icons: draw your own (inline SVG in your folder), one consistent set. No emoji.
- Copy is hard-coded English (the playground stays out of `i18n/`), using the glossary's words
  (`CONTEXT.md`): Library, *Want to read*, *Currently reading*, *Finished*, *Not finished*,
  Collection, Read again, Rating, review, Up next, Read in 2026.

## Screen keys

All 17 are frames in the gallery, in this order. `ref` shows a complete, plain version of each.

| Group | Key | Must show |
|---|---|---|
| Start | `sign-in` | Wordmark, invite-only sign-in: email field (filled), "Send code" (a six-digit code by email, no password), "Have an invite code? Sign up". |
| Home | `home` | Currently reading as large cards (cover, title, author, start date, Finish), the "Read in 2026" counter (13), Up next (first *Want to read* covers), account avatar, tab bar (Home · Library · Search). |
| | `home-empty` | Empty Library: a friendly empty state and one way forward (search). |
| Search | `search-typing` | Query being typed ("le gu"), keyboard up, results streaming in (Catalogue + Apple Books in), one source (Open Library) still loading. |
| | `search-results` | "le guin": merged list from three sources — cover, title, author, year, source; in-Library hits marked with their Status; others with a quick add. |
| | `search-empty` | No results for the query, explanation, **Add manually**. |
| | `manual-book` | The Manual book form: title, author (required), ISBN, pages (optional), the generated **Placeholder cover** preview, "only you can see it". |
| Book | `book-new` | Book detail not in the Library: cover, title, author, year · pages · publisher, **Add to Library**, collections ("Add to collection"), description. |
| | `add-sheet` | Sheet over `book-new`: Status choice (*Want to read* / *Currently reading* / *Finished*) with the date fields that choice needs (here: reading, started today). |
| | `book-reading` | Detail, *Currently reading* since a date: **Finish** and **Abandon**, the open session in the history, collections. |
| | `finish-sheet` | Sheet over `book-reading`: end date (today), **quarter-star Rating mid-drag** (3.75), review being typed, Finish. |
| | `book-finished` | Dune: *Finished*, latest Rating, **Read again**, reading history with **2 sessions** (dates, Rating, review each, editable), collections (Favourites, Sci-fi). |
| Library | `library-want` | Library tab: way into Collections, Status segments with counts (7 · 2 · 14), *Want to read* entries with added date. |
| | `library-reading` | Same, *Currently reading* with start dates. |
| | `library-finished` | Same, *Finished* with end dates and Ratings, the **Not finished** filter chip; one abandoned and one re-read entry among them. |
| Collections | `collections` | Collections as a list with **cover mosaics** (first covers), book counts, "New collection". |
| | `collection` | One collection (Sci-fi, 10 books) in the Member's order, reorder affordance, add, rename/delete menu. |

## Sample data (`data.ts`, via `useProto().data`)

Fabian's real books from his reading-tracker database, real ratings, real dates; invented: the
2019 first read of Dune, the abandoned *Titus Groan*, reviews, collections, the Manual book.
"Today" is **2 Oct 2026** (`data.today`). Covers are Apple Books artwork at 600 × 900, hard-coded
(no runtime lookups).

Types (glossary words): `Book`, `LibraryEntry`, `ReadingSession`, `Collection`, `SearchResult`,
`Status` (`'want_to_read' | 'reading' | 'finished'`), `CoverColors`.

- **Ratings are integer quarters 1–20** (17 = 4.25 stars), `null` = unrated — like the database.
  `stars(q)` → 4.25, `formatRating(q)` → "4.25".
- **`book.coverColors`** `{ dominant, secondary, isDark }` — precomputed from each cover (`#rrggbb`),
  `null` without a cover. Use it for ambient colour; never extract colours at runtime.
- **`book.pageCount`** is set on every sample Book (spines, progress). Typed nullable, like the
  database.
- `entry.sessions` oldest first; `latestSession(entry)` is the current one.

| Field | What |
|---|---|
| `member` | `{ name, firstName, initials, email }` |
| `library` | all 23 entries; `entry(id)` looks one up |
| `reading` (2), `wantToRead` (7), `finished` (14) | by Status; `finished` includes the abandoned one |
| `notFinished` | the *Not finished* filter (1) |
| `upNext` | first 5 *Want to read* |
| `readInYear` | `{ year: 2026, count: 13 }` |
| `collections` | Favourites (6), Sci-fi (10), To gift (3) |
| `collectionEntries(c)`, `collectionCovers(c, n)`, `collectionsOf(entry)` | helpers |
| `search` | `typingQuery`, `typingResults`, `typingLoading`, `query`, `results` (6), `emptyQuery` |
| `newBook` | *The Left Hand of Darkness* (not in the Library) for `book-new` / `add-sheet` |
| `addDraft` | `{ status: 'reading', statuses, startedOn, endedOn }` |
| `readingEntry` | *The Carpet Makers* (open session) for `book-reading` / `finish-sheet` |
| `finishDraft` | `{ endedOn, rating: 15, dragging: true, review }` |
| `finishedEntry` | *Dune*, two sessions, for `book-finished` |
| `libraryFilters` | All / Not finished |
| `openCollection` | Sci-fi, for `collection` |
| `manualDraft`, `manualBook` | the Manual book form values; the Manual book in the Library (no cover) |

Formatting helpers: `formatDate(iso, 'long' | 'short' | 'month')` ("17 May 2026", "17 May",
"May 2026"), `formatAuthors(authors)`. Types and helpers are plain imports
(`import { formatDate, latestSession, type LibraryEntry } from '../../../data'`); the data itself
comes through `useProto()`.

## Screenshots

With a dev server running:

```sh
node scripts/proto-shots.mjs                                   # all directions + Vergleich → /tmp/libellus-proto/
node scripts/proto-shots.mjs --url http://localhost:3022 --only a --no-vergleich
node scripts/proto-shots.mjs --screens home,book-finished --query "a.palette=dusk" --out /tmp/a-dusk
```

Headless WebKit, 2× scale. Writes `<direction>--<screen>.png` (the phone) and
`vergleich--<screen>.png` (all directions in a row). Look at your PNGs before calling a screen
done.
