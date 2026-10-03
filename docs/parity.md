# Parity checklist — the behavioural reference

The **web app is the reference** (SPEC.md). This file, together with the Playwright flows in
`web/e2e/`, is what any native port is built and checked against. Every PR that adds or changes a
screen updates its entry here — describe behaviour, not Vue code, so a port does not have to read
`.vue` files to know what a screen does.

Rules for a port, if one happens:
- Match the web behaviour exactly. No extra features, no redesign. Native idioms are allowed where the
  platform demands them (navigation stack, sheets, haptics), and noted in the entry.
- Same names across platforms: `app/data/` repositories, stores ↔ ViewModels
  (`useLibraryStore` ↔ `LibraryViewModel`).
- IDs: the web `data-testid` is the native `accessibilityIdentifier` (`<screen>.<element>`).
- Copy: the keys in `web/i18n/locales/en.json` are the keys of the native string catalogues
  (`Localizable.strings`, `strings.xml`). Entries name keys, not sentences.
- An entry is done on a platform only when its flow passes there (Playwright on web, Maestro native).

## Entry template

```
### <Screen name>  (web: `app/pages/<path>.vue`)
Purpose: one sentence.
States: loading · empty · content · error · offline (list what exists)
Actions → result:
- <action> → <what happens, incl. navigation and what the database is asked to do>
Edge cases: validation, limits, failures, offline
Copy keys: <screen>.<key>, …
IDs: <screen>.<element>, …
Flow: `web/e2e/<flow>.spec.ts`
- [ ] Web  - [ ] iOS  - [ ] Android
```

## Screens

### Sign in  (web: `app/pages/sign-in.vue`)
Purpose: the way back in for a member; one field, the address.
Layout: the way-in frame (`components/auth/Frame.vue`, docs/DESIGN.md): a wall of cloth covers behind a veil, the wordmark and tagline, the screen's eyebrow title, the form, the link to the other screen at the bottom. Same frame on Sign up and Verify, in both themes; the theme is the device's or the one chosen in the avatar menu (see Theme).
States: form · busy (submit disabled) · error (inline under the field, the field's rule turns red) · config problem (the build has no Supabase URL/key; replaces the form)
Actions → result:
- Submit address → asks Supabase Auth for a six-digit code for that address **without creating an account** (`createAuth.requestCode`). Known address: the address is stored as the *pending sign-in* (see Verify) and the app goes to Verify. Unknown address: not an error, the app goes to Sign up with the address prefilled.
- "Sign up" link (`signIn.signUpLink`) → Sign up (address field empty).
Edge cases: a malformed address is refused by the field (browser validation) or by the backend (`email_invalid`); asking for another mail within a second is `rate_limited`. A signed-in member opening this screen is sent to Home. A signed-out launch with a pending address is sent to Verify instead.
Copy keys: `app.name`, `app.tagline`, `signIn.title`, `signIn.intro`, `signIn.emailLabel`, `signIn.emailPlaceholder`, `signIn.submit`, `signIn.noAccount`, `signIn.signUpLink`, `signIn.configMissing`, `signIn.configInvalidUrl`, `auth.error.*`
IDs: `signIn.brand`, `signIn.title`, `signIn.email`, `signIn.error`, `signIn.submit`, `signIn.signUp`, `signIn.configProblem`
Flow: `web/e2e/auth.spec.ts` (every flow starts here)
- [x] Web  - [ ] iOS  - [ ] Android

### Sign up  (web: `app/pages/sign-up.vue`)
Purpose: a new member joins with their address and an invite code. Libellus is invite-only.
Layout: the way-in frame (see Sign in).
States: form · busy · error under the invite field (`invite_*`) or under the address field (anything else)
Actions → result:
- Submit address + invite code → the invite is pre-flighted (`invite_code_status` answers valid / invalid / expired / exhausted / missing), then Supabase Auth creates the account and mails a six-digit code (`createAuth.requestSignUpCode`); the address is stored as the pending sign-in and the app goes to Verify. Nothing is spent yet.
- "Sign in" link → Sign in.
Edge cases: the database gate is authoritative (a trigger on account creation refuses a missing, unknown, expired or used-up code); the pre-flight only tells the form why. The invite is **consumed when the address is proved** (Verify), and judged again under a lock: if the last use went to someone else in between, Verify fails with `invite_gone`. Codes are case-insensitive and trimmed. Signing up with an address that already has an account just mails it a sign-in code and costs no invite. Addresses that never get proved are removed after a day.
Copy keys: `app.name`, `app.tagline`, `signUp.title`, `signUp.intro`, `signUp.emailLabel`, `signUp.emailPlaceholder`, `signUp.inviteLabel`, `signUp.invitePlaceholder`, `signUp.submit`, `signUp.hasAccount`, `signUp.signInLink`, `auth.error.invite_required|invite_invalid|invite_expired|invite_exhausted`
IDs: `signUp.brand`, `signUp.title`, `signUp.email`, `signUp.emailError`, `signUp.inviteCode`, `signUp.inviteError`, `signUp.submit`, `signUp.signIn`
Flow: `web/e2e/auth.spec.ts` (sign up with the dev invite; an invalid invite is refused under its field)
- [x] Web  - [ ] iOS  - [ ] Android

### Verify  (web: `app/pages/verify.vue`)
Purpose: type the six-digit code from the mail. Typed, never a link, so it works inside the installed iOS PWA.
Layout: the way-in frame (see Sign in); six drawn cells, the next one lit with the lamp caret; Resend is a quiet pill, "Use another email" the link at the bottom.
States: waiting for the code · busy · error (under the code, all cells red) · resend cooling down (60 s after each mail; the pill is dimmed and counts down)
Actions → result:
- Type the sixth digit → submits (no button). Success: the member is signed in, the pending address is dropped, the app goes to Home. Failure: the error shows, the field clears and keeps the keyboard.
- Resend → mails a new code to the pending address (the sign-in call, in both flows) and restarts the 60 s cooldown.
- "Use another email" → drops the pending address, goes to Sign in.
Edge cases: **the pending address is persisted for one hour** (`libellus.pendingSignIn` in local storage: address, flow, time sent), so iOS killing the installed app while the member reads Mail does not lose it: a signed-out launch with a pending address opens Verify, and Verify without one goes to Sign in. After an hour it is discarded (the code expired too). One input, not six: the cells are only a drawing, so the iOS code suggestion and paste work (`autocomplete="one-time-code"`, numeric keyboard, digits only). A wrong, expired or already-used code is one error (`code_invalid`): Supabase deliberately cannot tell them apart. `invite_gone` when the invite ran out between Sign up and now. `rate_limited` when resend is tapped twice.
Copy keys: `app.name`, `app.tagline`, `verify.title`, `verify.sentTo`, `verify.codeLabel`, `verify.resend`, `verify.resendIn`, `verify.changeEmail`, `auth.error.code_invalid|invite_gone|rate_limited|unknown`
IDs: `verify.brand`, `verify.title`, `verify.sentTo`, `verify.code`, `verify.error`, `verify.resend`, `verify.changeEmail`
Flow: `web/e2e/auth.spec.ts` (the code read from Mailpit; a mistyped code; the pending address survives a relaunch)
- [x] Web  - [ ] iOS  - [ ] Android

### Tab shell  (web: `app/layouts/tabs.vue`, `components/shell/*`; pages `app/pages/{index,library}.vue`)
Purpose: the signed-in frame: each tab's header with the avatar, the page, the floating tab bar, and the search overlay that opens over all of it. Home shows its empty state until #8. A pushed screen (the book page) lives in the same frame without the header (see Book).
States: content (each tab shows its empty state) · avatar menu closed / open · search overlay closed / open (keyboard up: "typing", or down)
Actions → result:
- Tap Home or Library in the tab bar → shows Home (`/`) or Library (`/library`). The current tab is full ink with a lamp dot and its `aria-current="page"`; the others are faint. The header shows the page's title: Home under a date eyebrow (`home.today`, e.g. "Friday · 2 Oct"), Library large on its own.
- Tap Search in the tab bar, or the search prompt in an empty state → the **search overlay** opens over the current page; **the URL does not change** and the page stays behind it, blurred and veiled. The query field has the keyboard ("typing"): the bottom row is the search icon, the field (placeholder `search.placeholder`), a clear button once something is typed, and **Cancel**. With the keyboard down the row shows Home and Library at its left (the current one lit) instead of Cancel; tapping one goes there and closes the overlay. Above the row are the results (see Search).
- Close the overlay → Cancel (while typing), a tap on the page behind it (`search.backdrop`), swiping the palette down (more than 80 px, or a quick flick), Escape, or going to another page. The query is dropped; the page underneath is as it was.
- Tap the avatar (the initials of the address: `ida.tester@example.com` → `IT`, `ida@example.com` → `ID`) → opens the **avatar menu** (there is no profile screen): "Signed in as" and the address, the **Dark mode** switch, **Sign out**. It closes on a tap elsewhere, Escape, or changing tab; flipping the theme keeps it open.
- Dark mode switch → see Theme below. On when dark is showing.
- Sign out → ends the session on the device and revokes it on the server, removes everything the device cached under the `libellus.` prefix (the pending address now; the offline library cache later), goes to Sign in. The theme preference is not under that prefix and stays.
Edge cases: the session is restored on launch before the first route resolves, so a signed-in member never sees Sign in flash past. Signed-out members opening any route are sent to Sign in (to Verify if a code is pending); signed-in members opening Sign in / Sign up / Verify are sent Home. A session that ends elsewhere (another tab, a failed refresh) lands on Sign in too. In dev builds, routes starting with `/prototype` skip the guard. There is no `/search` route any more (search is never a page; nothing deep-links to it yet): it is an unknown route like any other. Wide screens: the same layout in a centred column with hairlines left and right; the tab bar and the overlay stay centred. Header, tab bar and overlay respect the iOS safe areas; with the keyboard up the overlay sits right above it. Native: the overlay is a sheet-like panel over the current view, not a pushed screen.
Copy keys: `app.name`, `tabs.home|library|search`, `home.title|today|emptyTitle|empty`, `library.title|emptyTitle|empty`, `search.title|placeholder|close|clear|empty`, `common.cancel`, `shell.tabsLabel`, `shell.avatarLabel`, `shell.signedInAs`, `shell.darkTheme`, `shell.signOut`
IDs: `shell.header`, `shell.avatar`, `shell.menu`, `shell.email`, `shell.theme`, `shell.signOut`, `shell.tabs`, `shell.tab.home|library|search`, `home.date`, `home.title`, `home.emptyTitle`, `home.empty`, `home.search`, `library.title`, `library.emptyTitle`, `library.empty`, `library.search`, `search.overlay`, `search.backdrop`, `search.query`, `search.clear`, `search.cancel`, `search.tab.home|library`, `search.empty`
Flow: `web/e2e/auth.spec.ts` (sign up → Home → Library → a reload keeps the session → the Search tab opens the overlay over Library and Cancel closes it → avatar → sign out → signed out again; the overlay closes on the page behind, a swipe down and Escape; the theme test below) and `web/e2e/search.spec.ts` (the tab bar turns into the palette and back by Cancel, the page behind, Escape and a swipe down — a short one settles back open — and the morph turned around halfway either way; end states only)
- [x] Web  - [ ] iOS  - [ ] Android

### Theme  (web: `app/utils/theme.ts`, `app/stores/theme.ts`, the switch in the avatar menu)
Purpose: light (D's Day) or dark (D's Night). Follows the phone until the member chooses (issue #1, story 70).
States: no preference (follows the device, live) · light · dark. The switch shows two states only: on = dark is showing.
Actions → result:
- First tap on the switch → stores **the opposite of what is showing**: on a dark phone with no preference, Light. Every later tap flips between Light and Dark. There is no way back to "follow the phone" from the interface.
- The stored choice → `<html data-theme>`, both `theme-color` tags (browser chrome, installed app's status bar) take the theme's surface colour; with no choice there is no attribute and each `theme-color` tag answers its own `prefers-color-scheme`.
Edge cases: stored on the device in local storage (`libellus-theme`), never in Supabase, not cleared by sign-out, so the way in looks as the member left it. Applied before the first paint by an inline script at the top of the HTML, so a launch never flashes the other theme. Unreadable or unknown stored values count as no preference; storage that refuses writes still flips the theme for the visit. Native: the same preference in the platform's user defaults, applied as the window's interface style; `null` = unspecified.
Copy keys: `shell.darkTheme`
IDs: `shell.theme`
Flow: `web/e2e/auth.spec.ts` (a dark phone → first tap stores Light → later taps flip regardless of the phone → kept across a reload, a tab change and sign-out); the rule in `web/tests/theme.test.ts`
- [x] Web  - [ ] iOS  - [ ] Android

### Error codes of the access flow
The data layer reports stable codes, never sentences (`app/data/auth.ts`, `AuthErrorCode`); the copy lives under `auth.error.<code>`: `invite_required`, `invite_invalid`, `invite_expired`, `invite_exhausted` (Sign up), `invite_gone` (Verify), `code_invalid` (Verify), `rate_limited` (resend), `email_invalid`, `not_configured`, `unknown`.

### Search  (web: `components/search/Results.vue`, `components/search/ResultRow.vue`, `stores/search.ts`, `data/search.ts`, `data/merge.ts`, `data/apple.ts`, `data/openLibrary.ts`, `data/catalogueSearch.ts`; database: `search_books`)
Purpose: find a Book from anywhere without leaving the page: the content of the search overlay (Tab shell) above its query row.
States: idle (query shorter than 2 characters: `search.empty`) · loading (nothing has answered with a result yet: one still ghost row, `search.loading` for assistive tech) · results (best match at the bottom next to the query, weaker ones above it, the far end fading out; `search.hint` at the top, except for an ISBN query) · results growing while slower sources answer (no indicator of its own) · results dimmed while a newer query is on its way · no results (every source answered, none found anything: `search.noResultsTitle`, `search.noResults` with the query, `search.noResultsHint`, and the way to the manual-book sheet: `search.addManually`) · failed (every source failed, or the device is offline: `search.failedTitle`, `search.failed`)
Actions → result:
- Type → after a 220 ms pause, and only from 2 characters, the query goes out to **three sources at once** (`createSearch().search`): the own Catalogue (`search_books`: the beginnings of the words of title and authors, accents and case ignored, `ß` as `ss`; the member's own Manual books included, other members' never), Apple Books (iTunes Search API, ebooks, 20 per storefront, two storefronts) and OpenLibrary (`search.json` with a reduced field list and the device language, 20 works, each as its best edition). Every answer is merged into the list as it arrives. Every new keystroke aborts the query in flight in every source; an answer only lands for the query it was asked for, so an outdated answer never overwrites a newer one. Clearing or shortening the query below 2 characters goes back to idle.
- An ISBN (10 or 13 digits, hyphens and spaces allowed, ISBN-10 converted) is looked up as an ISBN in every source (Catalogue by `isbn13`, Apple `lookup?isbn=`, OpenLibrary `search.json?isbn=`) instead of searched as text.
- Merging (`data/merge.ts`, `mergeResults`): Catalogue hits first, then Apple, then OpenLibrary, each in its own order. **The same edition** (Catalogue id, ISBN-13 with ISBN-10s converted, Apple track id, OpenLibrary edition key) is kept once; the first keeps its place and the later one fills its empty fields. **The same book** (normalised title + normalised first author: accents, case and punctuation ignored) is kept once too — one row per book, not per edition (owner decision on #12): the row shows the edition the member has, else the Catalogue's, else the first one found (the device language's storefront answers first). A specific edition is one ISBN search away (`search.hint`).
- Ranking: by how well the query matches (`matchQuality`, 0–100): title = query (100) › title without its subtitle = query (92) › title and first-author words together, e.g. "piranesi clarke" (88) › first author = query (85) › title begins with the query (80, or 75 mid-word) › every word begins a word of the first author (70) › of the title (65) › of title and authors together (55) › of a later author only (45) › some words (up to 40). Ties: Catalogue first, then popularity (Apple's rating count, OpenLibrary's reading-log and rating counts), then the order the sources gave. So "Piranesi" puts Susanna Clarke's novel next to the query and Gibbon's histories (Piranesi a later author) after every title match.
- **Where a result comes from is never shown** (owner decision on #6): no source names, badges, counts or per-source loading. Each row: cover (`UiCover` sm: a small Apple size, OpenLibrary's medium image; the first six load eagerly and are preloaded when the answer lands; a Catalogue Book brings its stored thumbhash and colours, so it sits on its blur while loading, others on a quiet fill; no image: the Placeholder cover), title (serif), authors, year (mono). A Book the member has (matched by Catalogue id, ISBN-13 or source id against her whole Library, read when the search opens) shows `status.<status>` with a check instead of the +. A row of a book she has **in another edition** (same title and first author, not the same Book) keeps its + and says `search.otherEdition` next to the year (`search.resultOtherEdition`).
- Tap a row → the book page `/book/<key>` (a Catalogue Book by id, otherwise `apple-<trackId>`, `ol-<edition key>` or `isbn-<isbn13>`); the route change closes the search. The touch-down already asks for the page's data (`UiPressLink`, `book.prefetch`); a mouse press navigates on press, a finger on its tap.
- Tap + (`search.add`, label `search.add` with the title) → the Add sheet over the search; after adding, the row shows its Status (and any other row of the same book says `search.otherEdition`).
Edge cases: Apple's storefronts follow the device language: German (`de`, `de-*`) → `de` then `us`; anything else → `us` then `gb`. **A failing source is silent**: the others' results stay, with no note; one storefront failing leaves the other's. Only when every source fails — or the device is offline (then nothing is asked) — does the failed state show. The Library read failing only means nothing is marked. The list may grow up to the height above the query row (the visual viewport, so it stays above the keyboard) and scrolls; dragging inside the list scrolls rather than swiping the palette away. Closing the search drops the query and the results.
Copy keys: `search.addManually`, `search.empty`, `search.loading`, `search.hint`, `search.add`, `search.otherEdition`, `search.noResultsTitle`, `search.noResults`, `search.noResultsHint`, `search.failedTitle`, `search.failed`, `status.*`, `common.etAl`
IDs: `search.addManually`, `search.empty`, `search.loading`, `search.results`, `search.result`, `search.resultTitle`, `search.resultStatus`, `search.resultOtherEdition`, `search.add`, `search.hint`, `search.noResults`, `search.failed`
Flow: `web/e2e/full-search.spec.ts` (one list from every source with the Piranesi ranking and no source named → an OpenLibrary-only Book opened and added with its OpenLibrary cover → found again from the Catalogue with its status; an ISBN query; the Catalogue failing silently with another edition in the Library pointed out; every source failing; offline) and `web/e2e/search-and-add.spec.ts`; Apple and OpenLibrary answer from the recordings in `web/tests/fixtures/apple` and `web/tests/fixtures/openlibrary`. The repository and the merge in `web/tests/search.test.ts` (merge order, dedupe, storefront choice, ranking, other edition, stale queries, failing sources), the Catalogue against the stack in `web/tests/catalogue.test.ts`, the database function in `supabase/tests/catalogue_search_test.sql`
Native: the merge and ranking are pure functions (`data/merge.ts`) to port line for line; the Catalogue is the same `search_books` call.
- [x] Web  - [ ] iOS  - [ ] Android

### Book  (web: `app/pages/book/[key].vue`, `stores/book.ts`, `stores/reading.ts`)
Purpose: one Book: what it is, and the one action its state asks for.
Layout: a pushed screen: no tab header; the round back button over the cover's light (`UiAmbient` in the cover's colours), the cover large with its glow, title (serif), authors, the facts in mono eyebrow type (year · pages · publisher, whichever are known), a status line, the action, then About. The tab bar and search stay available.
States: loading (no Book known yet: a cover-shaped placeholder) · not in the Library (`book.notInLibrary`, primary **Add to Library**) · Want to read (status line `status.want_to_read` · `book.addedOn` with the day; primary **Start reading**) · Currently reading (status line: a lit lamp dot, `status.reading` · `book.since` "Since 3 Oct · day 4", day 1 being the start day; primary **Finish**) · Finished (status line: the latest finished session's Rating as stars with its value, if rated, `status.finished` · the end day; no action until #10 brings Read again) · missing (`book.missingTitle`, `book.missing`) · error (`book.errorTitle`, `book.error`, Retry)
Actions → result:
- Add to Library (`book.add`) → the Add sheet. After the add the page shows the Status without reloading.
- Start reading (`book.start`) → the Start sheet. After the start the page shows Currently reading and Finish, without reloading.
- Finish (`book.finish`) → the Finish sheet. After the finish the page shows Finished with the Rating.
- More (`book.more`, only for a long description) → the whole description; it starts clamped to five lines.
- Back (`book.back`) → the previous page with its scroll position (the tab pages are kept alive); a page opened from a link with no history goes to Library.
Edge cases: `/book/<uuid>` is a Catalogue Book (or the member's Manual book): the Book and the member's entry are read. `/book/apple-<id>` (and `/book/isbn-<isbn13>`) is a search result: shown at once from what search found, then checked against the Catalogue (by ISBN-13 first, then the source id, the same order `add_to_library` matches in); if it is there, the Catalogue Book and the member's entry replace it. Opened cold (a link, a reload), the source is asked again (Apple lookup in the device's two storefronts; `/book/ol-<key>` asks OpenLibrary for that edition; `/book/isbn-<isbn13>` asks Apple, then OpenLibrary); a Book no source has is missing, no storefront answering is the error state with Retry. The source of a Book is never shown. A refresh that fails keeps what is showing.
Copy keys: `book.back`, `book.pages`, `book.add`, `book.start`, `book.finish`, `book.since`, `book.notInLibrary`, `book.addedOn`, `rating.label`, `book.about`, `book.more`, `book.loading`, `book.missingTitle`, `book.missing`, `book.errorTitle`, `book.error`, `book.retry`, `status.*`, `common.dayMonth`, `common.etAl`
IDs: `book.back`, `book.hero`, `book.title`, `book.authors`, `book.facts`, `book.notInLibrary`, `book.actions`, `book.state`, `book.status`, `book.since`, `book.rating`, `book.add`, `book.start`, `book.finish`, `book.about`, `book.description`, `book.more`, `book.loading`, `book.missing`, `book.retry`
Flow: `web/e2e/search-and-add.spec.ts` (open from search, add, back; open from a link), `web/e2e/start-and-finish.spec.ts` (Start reading → Finish → Finished with its Rating)
Native: a pushed view in the navigation stack.
- [x] Web  - [ ] iOS  - [ ] Android

### Add sheet  (web: `components/book/AddSheet.vue`, `stores/library.ts`)
Purpose: put a Book into the Library with a Status (D's add-sheet).
Layout: `UiSheet` (Cancel at the top left, title `add.title`), the Book (`UiBookLine`), the eyebrow `add.statusLabel`, the Status choice as radio rows (the chosen one lit in the lamp colour, with what it needs on the right: `add.needs.<status>`), the error if any, the primary **Add to Library** at the bottom.
States: choosing · busy (`add.busy`, button disabled) · error (`library.error.<code>` under the choice; the sheet stays open)
Actions → result:
- Add to Library (`add.submit`) → if the Book is not in the Catalogue yet, its Cover is resolved first (`resolveBookCover`, at most 6 s), trying in order until an image will do: the Apple artwork → Apple's edition with the Book's ISBN → OpenLibrary's cover by its cover id → OpenLibrary's cover by ISBN. Each is read (fetched with CORS, decoded off the page) from a smaller copy; one shorter than 150 px on its short side, or of one flat colour, is passed over. The one that will do is kept large (Apple `…/600x900bb.jpg`, OpenLibrary `-L.jpg`) with its thumbhash and two colours; if none will do the Book gets the Placeholder cover (no URL), unless its own image only could not be read in time (then it keeps that URL without thumbhash and colours). Then **one database call**, `add_to_library(p_book, p_status)`: finds the Catalogue Book by ISBN-13 or source id (or adds this snapshot, as the large `…/600x900bb.jpg` artwork URL with the thumbhash and colours; the first snapshot is kept) and creates the entry. The sheet closes; Library, the book page and search show the entry at once.
- Cancel, the scrim, a swipe down, Escape → closes, nothing is added.
Edge cases: this slice offers only *Want to read* (`ADDABLE_STATUSES`); #9 adds Currently reading and Finished with their dates below the choice. Adding a Book the member already has fails with `already_in_library`.
Copy keys: `add.title`, `add.statusLabel`, `add.needs.want_to_read`, `add.action`, `add.busy`, `status.*`, `library.error.*`, `common.cancel`
IDs: `add`, `add.cancel`, `add.scrim`, `add.status.want_to_read`, `add.error`, `add.submit`
Flow: `web/e2e/search-and-add.spec.ts` (from the book page and from a result's +); the database rule in `supabase/tests/library_test.sql`, the repository in `web/tests/library.test.ts`
Native: a sheet.
- [x] Web  - [ ] iOS  - [ ] Android

### Start sheet  (web: `components/book/StartSheet.vue`, `stores/reading.ts`)
Purpose: start the first read of a *Want to read* Book (issue #7; issue #1, story 31).
Layout: `UiSheet` (Cancel at the top left, title `start.title`), the Book (`UiBookLine`), one grouped row `start.startedOn` with the day in words (`UiDateRow`: "Today · 3 Oct", `common.today|yesterday`, other days `common.dayMonth` or `common.dayMonthYear`) and a chevron, the error if any, the primary **Start reading** at the bottom.
States: choosing (the day defaults to the member's today, on the device's calendar) · busy (`start.busy`, button disabled) · error (`library.error.<code>` under the row, the day error-coloured for a day problem; the button reads `start.retry` and tries again)
Actions → result:
- The day row → the platform's own date picker (an invisible native date input over the row), latest day today.
- Start reading (`start.submit`) → the day is checked on the device (missing → `date_invalid`, after today → `date_in_future`); then **one database call**, `start_reading(p_entry_id, p_started_on)`, which opens a session; the entry's Status turns to Currently reading in the database. The sheet closes, the book page and the Library show the new state without reloading.
- Cancel, the scrim, a swipe down, Escape → closes, nothing is started.
Edge cases: a second device starting the same Book first → `already_reading`; a Book read before → `already_finished` (#10's Read again). The database refuses a day after today in every time zone (`date_in_future`), so a member east of UTC can always start "today".
Copy keys: `start.title`, `start.startedOn`, `start.action`, `start.busy`, `start.retry`, `common.today`, `common.yesterday`, `common.dayMonth`, `common.dayMonthYear`, `common.chooseDay`, `library.error.*`, `common.cancel`
IDs: `start`, `start.cancel`, `start.scrim`, `start.date`, `start.error`, `start.submit`
Flow: `web/e2e/start-and-finish.spec.ts` (start today; a day in the future refused in the sheet; a failed call kept in the sheet and retried); the rules in `supabase/tests/reading_sessions_test.sql`, the repository in `web/tests/reading.test.ts`
Native: a sheet; the day row opens the platform's date picker.
- [x] Web  - [ ] iOS  - [ ] Android

### Finish sheet  (web: `components/book/FinishSheet.vue`, `components/ui/RatingInput.vue`, `stores/reading.ts`)
Purpose: finish the open read with an end day, an optional quarter-star Rating and an optional review (D's finish-sheet; issue #1, stories 32–34).
Layout: `UiSheet` (Cancel, title `finish.title`), the Book, one grouped row `finish.endedOn` (as in the Start sheet), the rating control, the review box (`finish.review` · `finish.optional`, placeholder `finish.reviewPlaceholder`, serif italic, a lamp ring while focused), the error if any, the primary **Finish**.
Rating control: the eyebrow `rating.title` with `rating.optional` (or **Clear**, `rating.clear`, once rated) opposite; the value large in the accent with `rating.outOf` ("3.75 / 5"), or `rating.none` until there is one; five 44-pt stars filled to the quarter; under them a rail with 21 notches (0–5 in quarters, whole stars taller, the ones up to the value lit) and a thumb at the value, with a thin guide up into the stars; the hint `rating.hint`.
States: choosing (end day today, no Rating, empty review) · busy (`finish.busy`, button disabled, the control and the review locked) · error (`library.error.<code>` above the button; the button reads `finish.retry`)
Actions → result:
- Drag across the stars → the Rating follows the finger and snaps to the nearest quarter notch (`utils/rating.ts`, `quartersAt`); dragging off the left of the first star empties it. Vertical drags still scroll the sheet, and the sheet never takes a drag on the control for a swipe down.
- Tap a star → that many whole stars (`wholeStarsAt`). Clear → no Rating.
- Keyboard / assistive tech: the control is a slider (0–5, `rating.label` as its value text): arrows ±¼, Page Up/Down ±1, Home empties, End is 5.
- Finish (`finish.submit`) → the day is checked on the device (missing, after today, before the read's start → `ended_before_started`); then **one database call**, `finish_reading(p_entry_id, p_ended_on, p_rating, p_review)`: the open session closes as finished with the day, the Rating in quarters (1–20, 3.75 = 15) and the review trimmed (blank is none). The entry's Status turns to Finished in the database; the sheet closes; the Book moves from Currently reading to Finished in the Library and the book page shows its Rating.
- Cancel, the scrim, a swipe down, Escape → closes; what was chosen stays for the next time the same Book's sheet opens (until it is finished or another member signs in).
Edge cases: the review takes at most 10,000 characters (`review_too_long` from the database otherwise). Reading the same Book's sheet on two devices: the second finish gets `not_reading`.
Copy keys: `finish.title`, `finish.endedOn`, `finish.review`, `finish.optional`, `finish.reviewPlaceholder`, `finish.action`, `finish.busy`, `finish.retry`, `rating.title`, `rating.optional`, `rating.clear`, `rating.outOf`, `rating.none`, `rating.label`, `rating.hint`, `common.today|yesterday|dayMonth|dayMonthYear|chooseDay`, `library.error.*`, `common.cancel`
IDs: `finish`, `finish.cancel`, `finish.scrim`, `finish.date`, `finish.rating` (the slider), `finish.rating.value`, `finish.rating.clear`, `finish.review`, `finish.error`, `finish.submit`
Flow: `web/e2e/start-and-finish.spec.ts` (a tap gives 2 stars, a drag 3.75, a review, Finish → Finished; the stored session has 15 quarters); the control's geometry in `web/tests/rating-control-and-days.test.ts`, the repository in `web/tests/reading.test.ts`, the rules in `supabase/tests/reading_sessions_test.sql`
Native: a sheet; the rating control is a custom control with the same geometry (`ratingX`), haptics on each quarter allowed.
- [x] Web  - [ ] iOS  - [ ] Android

### Library  (web: `app/pages/library.vue`, `components/library/EntryRow.vue`, `components/library/ReadingCard.vue`)
Purpose: the member's Books by Status.
Layout: the tab header (Library), the Status segments with their counts (`library.segment.*`; the chosen one lit with a lamp hairline), then the chosen segment's entries.
States: loading (first visit, nothing yet) · empty Library (the lamp over the empty shelf: `library.emptyTitle`, `library.empty`, the search prompt) · Want to read (rows: cover, serif title, authors, `library.added` with the date in mono; newest added first) · Currently reading (a card per Book on the raised surface in its cover's light: cover with its glow, serif title, authors, `book.since` "Since 3 Oct · day 4", and a quiet **Finish** on the card; newest start first) · Finished (grouped by the year of the end date, an eyebrow with the year and its count; rows: cover, title, authors, the Rating as small stars with its value or `rating.none`, then the end day; newest end first, entries without an end date last under `library.undated`) · a segment without entries (`library.segmentEmpty.<status>.title|text`) · load error (`library.loadError`, Retry)
Actions → result:
- Tap a segment → shows its entries. The counts are each list's length.
- Finish on a Currently reading card (`library.finish`) → the Finish sheet over the Library; after it the Book leaves Currently reading and appears in Finished in its place.
- Tap a row → the book page `/book/<id>`, started on touch-down (`UiPressLink`).
Edge cases: the page is kept alive: coming back (from a book page, another tab) finds the same segment and scroll position, and the list refreshes in the background. An add, start or finish elsewhere moves the entry into its list, in its place, at once (`library.entryChanged`, the same order the database sorts by: `sortEntries`). The three lists load together, each as one request with the entries' latest sessions (`latest_session`). The *Not finished* filter (abandoned reads) comes with #10. Signing out (or another member signing in) forgets the list.
Copy keys: `library.title`, `library.emptyTitle`, `library.empty`, `library.segmentsLabel`, `library.segment.*`, `library.segmentEmpty.*`, `library.added`, `library.undated`, `book.since`, `book.finish`, `rating.none`, `rating.label`, `library.loadError`, `library.retry`, `common.dayMonth`, `common.dayMonthYear`, `common.etAl`
IDs: `library.title`, `library.emptyTitle`, `library.empty`, `library.search`, `library.segment.want_to_read|reading|finished`, `library.wantToRead`, `library.reading`, `library.readingCard`, `library.finish`, `library.finished`, `library.year`, `library.yearTitle`, `library.entry`, `library.entryTitle`, `library.entrySince`, `library.entryRating`, `library.entryUnrated`, `library.entryEnded`, `library.segmentEmpty.<status>`, `library.loadError`, `library.retry`
Flow: `web/e2e/search-and-add.spec.ts` (empty → two Books, newest first → back keeps the scroll → an empty segment), `web/e2e/start-and-finish.spec.ts` (Currently reading card → Finish → Finished under the year with 3.75 stars); the order in `web/tests/reading.test.ts`
- [x] Web  - [ ] iOS  - [ ] Android

### Error codes of the Library
`app/data/library.ts`, `LibraryErrorCode`; copy under `library.error.<code>`: `already_in_library` (the member already has this Book), `book_invalid` (no title, not an Apple Books or OpenLibrary snapshot, or nothing to find the Book by again), `status_unsupported` (a Status this version cannot add with yet), `not_signed_in`, `unknown` (also for `book_conflict`, a concurrent add of the same new Book that rolled back: trying again works). The database raises them as the messages of `add_to_library`. The session actions (#7) add `entry_not_found` (no such entry in the member's Library, another member's included), `already_reading` (start: a read is open), `already_finished` (start: read before; Read again is #10), `not_reading` (finish: no open read), `date_invalid` (no day), `date_in_future` (a day after today), `ended_before_started`, `rating_invalid` (outside 1–20 quarters), `review_too_long` (over 10,000 characters); a network failure is `unknown`. The sheets check the day themselves first, so the member hears why before anything is sent; the database is the authority.

### Manual book sheet  (web: `components/book/ManualSheet.vue`, `stores/manual.ts`, `data/manualBooks.ts`, the link in `components/search/Results.vue`)
Purpose: type a book in by hand when search finds nothing, and track it like any other (D's manual-book). The Book is the member's own: private, never in the Catalogue, never in anybody else's search.
Layout: `UiSheet` (Cancel at the top left, title `manual.title`, **Add** at the right) over the search. The Placeholder cover as a preview (`UiCover` md, follows the title and author as they are typed; `manual.coverNote`), a group of two rows, Title\* and Author\*, a second group of two optional rows, ISBN and Pages (mono), the reason a field is wrong, the lock line `manual.private`, the primary **Add to Library**. A row is label left, input right-aligned; the row being typed in is lit in the lamp tint.
Entry: in the search's no-results state, the quiet button `search.addManually` under `search.noResultsHint`. It opens the sheet with what was typed: an ISBN fills ISBN, anything else fills Title.
States: editing · busy (`manual.busy`, action and button disabled) · a field wrong (its label and text in the error colour, one line `manual.invalid.<field>` under the groups) · error (`manual.error.<code>` in the same place; the sheet stays open)
Actions → result:
- Add (`manual.action`, `manual.submit`, or Enter in a field) → the fields are checked first (title and author not blank; ISBN 10 or 13 digits with a matching check digit, hyphens and spaces allowed; pages a whole number above zero) and nothing is sent while one is wrong. Then **one call**, `add_manual_book(title, authors, isbn, page_count, status)`: the Book (`source = manual`, `owner_id` = the member, an ISBN-10 also stored as ISBN-13) and the member's entry on *Want to read*; it returns the entry. The sheet closes, the search closes with its query, and the Book's page opens (`/book/<id>`); the Library lists it on *Want to read*.
- Cancel (`manual.cancel`), the scrim, Escape or a swipe down → the sheet closes; the search is as it was.
Placeholder cover: a Manual book has no image, so everywhere it appears (Library rows, the book page, the sheet) `UiCover` draws title and author on a cloth, picked by the title (`clothOf`, six cloths, the same in both themes). The same title always gets the same cloth.
Edge cases: private by RLS, not by filtering: `books_readable` shows a row with an owner to its owner only, so another member cannot read it, find it by title or ISBN, add it to a Library or open its page (missing), and members never write `books` directly (not even their own Manual books; editing them is not part of v1). Two members typing in the same book each get their own; the Catalogue's unique indexes leave Manual books out. Deleting a member deletes her Manual books. `status` is `want_to_read` only until #9 widens `add_to_library` and `add_manual_book` together.
Copy keys: `search.addManually`, `manual.title`, `manual.action`, `manual.coverNote`, `manual.field.<title|author|isbn|pageCount>`, `manual.optional`, `manual.private`, `manual.submit`, `manual.busy`, `manual.invalid.<field>`, `manual.error.<code>`, `common.cancel`
IDs: `search.addManually`, `manual`, `manual.scrim`, `manual.cancel`, `manual.action`, `manual.cover`, `manual.title`, `manual.author`, `manual.isbn`, `manual.pageCount`, `manual.invalid`, `manual.error`, `manual.private`, `manual.submit`
Flow: `web/e2e/manual-book.spec.ts` (empty search → add manually → required fields and a wrong ISBN → the Book's page → Library with the generated cover; an ISBN query fills the ISBN); the repository in `web/tests/manual-books.test.ts`; the database in `supabase/tests/manual_books_test.sql`
- [x] Web  - [ ] iOS  - [ ] Android

### Error codes of the manual-book call
`app/data/manualBooks.ts`, `ManualBookErrorCode` = the Library's codes plus `isbn_invalid`; copy under `manual.error.<code>`. The database raises them as the messages of `add_manual_book`: `book_invalid` (no title, no author, or a page count that is not positive), `isbn_invalid` (not 10 or 13 digits, or the check digit does not add up), `status_unsupported`, `not_signed_in`; `unknown` for the rest.

<!-- Filled as the screens land: Book detail and the
     Add / Finish / Abandon sheets (#6, #7, #9, #10, #11), Home (#8),
     Library and Collections (#14), offline states (#15). #16 completes the set. -->
