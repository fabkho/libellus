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
Purpose: the signed-in frame: each tab's header with the avatar, the page, the floating tab bar, and the search overlay that opens over all of it. Home and Library show their empty state until their tickets land.
States: content (each tab shows its empty state) · avatar menu closed / open · search overlay closed / open (keyboard up: "typing", or down)
Actions → result:
- Tap Home or Library in the tab bar → shows Home (`/`) or Library (`/library`). The current tab is full ink with a lamp dot and its `aria-current="page"`; the others are faint. The header shows the page's title: Home under a date eyebrow (`home.today`, e.g. "Friday · 2 Oct"), Library large on its own.
- Tap Search in the tab bar, or the search prompt in an empty state → the **search overlay** opens over the current page; **the URL does not change** and the page stays behind it, blurred and veiled. The query field has the keyboard ("typing"): the bottom row is the search icon, the field (placeholder `search.placeholder`), a clear button once something is typed, and **Cancel**. With the keyboard down the row shows Home and Library at its left (the current one lit) instead of Cancel; tapping one goes there and closes the overlay. Above the row is the results slot; until search lands (#6, #12) it shows `search.empty`.
- Close the overlay → Cancel (while typing), a tap on the page behind it (`search.backdrop`), swiping the palette down (more than 80 px, or a quick flick), Escape, or going to another page. The query is dropped; the page underneath is as it was.
- Tap the avatar (the initials of the address: `ida.tester@example.com` → `IT`, `ida@example.com` → `ID`) → opens the **avatar menu** (there is no profile screen): "Signed in as" and the address, the **Dark mode** switch, **Sign out**. It closes on a tap elsewhere, Escape, or changing tab; flipping the theme keeps it open.
- Dark mode switch → see Theme below. On when dark is showing.
- Sign out → ends the session on the device and revokes it on the server, removes everything the device cached under the `libellus.` prefix (the pending address now; the offline library cache later), goes to Sign in. The theme preference is not under that prefix and stays.
Edge cases: the session is restored on launch before the first route resolves, so a signed-in member never sees Sign in flash past. Signed-out members opening any route are sent to Sign in (to Verify if a code is pending); signed-in members opening Sign in / Sign up / Verify are sent Home. A session that ends elsewhere (another tab, a failed refresh) lands on Sign in too. In dev builds, routes starting with `/prototype` skip the guard. There is no `/search` route any more (search is never a page; nothing deep-links to it yet): it is an unknown route like any other. Wide screens: the same layout in a centred column with hairlines left and right; the tab bar and the overlay stay centred. Header, tab bar and overlay respect the iOS safe areas; with the keyboard up the overlay sits right above it. Native: the overlay is a sheet-like panel over the current view, not a pushed screen.
Copy keys: `app.name`, `tabs.home|library|search`, `home.title|today|emptyTitle|empty`, `library.title|emptyTitle|empty`, `search.title|placeholder|close|clear|empty`, `common.cancel`, `shell.tabsLabel`, `shell.avatarLabel`, `shell.signedInAs`, `shell.darkTheme`, `shell.signOut`
IDs: `shell.header`, `shell.avatar`, `shell.menu`, `shell.email`, `shell.theme`, `shell.signOut`, `shell.tabs`, `shell.tab.home|library|search`, `home.date`, `home.title`, `home.emptyTitle`, `home.empty`, `home.search`, `library.title`, `library.emptyTitle`, `library.empty`, `library.search`, `search.overlay`, `search.backdrop`, `search.query`, `search.clear`, `search.cancel`, `search.tab.home|library`, `search.empty`
Flow: `web/e2e/auth.spec.ts` (sign up → Home → Library → a reload keeps the session → the Search tab opens the overlay over Library and Cancel closes it → avatar → sign out → signed out again; the overlay closes on the page behind, a swipe down and Escape; the theme test below)
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

<!-- Filled as the screens land: Search (#6, #12), Book detail and the
     Add / Finish / Abandon sheets (#6, #7, #9, #10, #11), Home (#8), Manual book (#13),
     Library and Collections (#14), offline states (#15). #16 completes the set. -->
