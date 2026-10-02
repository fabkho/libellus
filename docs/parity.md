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
States: form · busy (submit disabled) · error (inline under the field) · config problem (the build has no Supabase URL/key; replaces the form)
Actions → result:
- Submit address → asks Supabase Auth for a six-digit code for that address **without creating an account** (`createAuth.requestCode`). Known address: the address is stored as the *pending sign-in* (see Verify) and the app goes to Verify. Unknown address: not an error, the app goes to Sign up with the address prefilled.
- "Create an account" link → Sign up (address field empty).
Edge cases: a malformed address is refused by the field (browser validation) or by the backend (`email_invalid`); asking for another mail within a second is `rate_limited`. A signed-in member opening this screen is sent to Home. A signed-out launch with a pending address is sent to Verify instead.
Copy keys: `app.name`, `signIn.title`, `signIn.intro`, `signIn.emailLabel`, `signIn.emailPlaceholder`, `signIn.submit`, `signIn.noAccount`, `signIn.signUpLink`, `signIn.configMissing`, `signIn.configInvalidUrl`, `auth.error.*`
IDs: `signIn.brand`, `signIn.title`, `signIn.email`, `signIn.error`, `signIn.submit`, `signIn.signUp`, `signIn.configProblem`
Flow: `web/e2e/auth.spec.ts` (every flow starts here)
- [x] Web  - [ ] iOS  - [ ] Android

### Sign up  (web: `app/pages/sign-up.vue`)
Purpose: a new member joins with their address and an invite code. Libellus is invite-only.
States: form · busy · error under the invite field (`invite_*`) or under the address field (anything else)
Actions → result:
- Submit address + invite code → the invite is pre-flighted (`invite_code_status` answers valid / invalid / expired / exhausted / missing), then Supabase Auth creates the account and mails a six-digit code (`createAuth.requestSignUpCode`); the address is stored as the pending sign-in and the app goes to Verify. Nothing is spent yet.
- "Sign in" link → Sign in.
Edge cases: the database gate is authoritative (a trigger on account creation refuses a missing, unknown, expired or used-up code); the pre-flight only tells the form why. The invite is **consumed when the address is proved** (Verify), and judged again under a lock: if the last use went to someone else in between, Verify fails with `invite_gone`. Codes are case-insensitive and trimmed. Signing up with an address that already has an account just mails it a sign-in code and costs no invite. Addresses that never get proved are removed after a day.
Copy keys: `signUp.title`, `signUp.intro`, `signUp.emailLabel`, `signUp.emailPlaceholder`, `signUp.inviteLabel`, `signUp.invitePlaceholder`, `signUp.submit`, `signUp.hasAccount`, `signUp.signInLink`, `auth.error.invite_required|invite_invalid|invite_expired|invite_exhausted`
IDs: `signUp.title`, `signUp.email`, `signUp.emailError`, `signUp.inviteCode`, `signUp.inviteError`, `signUp.submit`, `signUp.signIn`
Flow: `web/e2e/auth.spec.ts` (sign up with the dev invite; an invalid invite is refused under its field)
- [x] Web  - [ ] iOS  - [ ] Android

### Verify  (web: `app/pages/verify.vue`)
Purpose: type the six-digit code from the mail. Typed, never a link, so it works inside the installed iOS PWA.
States: waiting for the code · busy · error (under the code) · resend cooling down (60 s after each mail)
Actions → result:
- Type the sixth digit → submits (no button). Success: the member is signed in, the pending address is dropped, the app goes to Home. Failure: the error shows, the field clears and keeps the keyboard.
- Resend → mails a new code to the pending address (the sign-in call, in both flows) and restarts the 60 s cooldown.
- "Use another email" → drops the pending address, goes to Sign in.
Edge cases: **the pending address is persisted for one hour** (`libellus.pendingSignIn` in local storage: address, flow, time sent), so iOS killing the installed app while the member reads Mail does not lose it: a signed-out launch with a pending address opens Verify, and Verify without one goes to Sign in. After an hour it is discarded (the code expired too). One input, not six: the cells are only a drawing, so the iOS code suggestion and paste work (`autocomplete="one-time-code"`, numeric keyboard, digits only). A wrong, expired or already-used code is one error (`code_invalid`): Supabase deliberately cannot tell them apart. `invite_gone` when the invite ran out between Sign up and now. `rate_limited` when resend is tapped twice.
Copy keys: `verify.title`, `verify.sentTo`, `verify.codeLabel`, `verify.resend`, `verify.resendIn`, `verify.changeEmail`, `auth.error.code_invalid|invite_gone|rate_limited|unknown`
IDs: `verify.title`, `verify.sentTo`, `verify.code`, `verify.error`, `verify.resend`, `verify.changeEmail`
Flow: `web/e2e/auth.spec.ts` (the code read from Mailpit; a mistyped code; the pending address survives a relaunch)
- [x] Web  - [ ] iOS  - [ ] Android

### Tab shell  (web: `app/layouts/tabs.vue`; pages `app/pages/{index,library,search}.vue`)
Purpose: the signed-in frame: a header with the avatar, the page, a bottom tab bar. Home, Library and Search are placeholders with an empty-state line until their tickets land.
States: content (each tab shows its empty state) · avatar menu closed / open
Actions → result:
- Tap a tab → shows Home (`/`), Library (`/library`) or Search (`/search`); the current tab is bold.
- Tap the avatar (the initials of the address: `ida.tester@example.com` → `IT`, `ida@example.com` → `ID`) → opens a small menu with "Signed in as <address>" and **Sign out**. It closes on a tap elsewhere, Escape, or changing tab.
- Sign out → ends the session on the device and revokes it on the server, removes everything the device cached under the `libellus.` prefix (the pending address now; the offline library cache later), goes to Sign in.
Edge cases: the session is restored on launch before the first route resolves, so a signed-in member never sees Sign in flash past. Signed-out members opening any route are sent to Sign in (to Verify if a code is pending); signed-in members opening Sign in / Sign up / Verify are sent Home. A session that ends elsewhere (another tab, a failed refresh) lands on Sign in too. In dev builds, routes starting with `/prototype` skip the guard. Wide screens: the same layout in a centred column. Header and tab bar respect the iOS safe areas.
Copy keys: `app.name`, `tabs.home|library|search`, `home.title|empty`, `library.title|empty`, `search.title|empty`, `shell.tabsLabel`, `shell.avatarLabel`, `shell.signedInAs`, `shell.signOut`
IDs: `shell.header`, `shell.avatar`, `shell.menu`, `shell.email`, `shell.signOut`, `shell.tabs`, `shell.tab.home|library|search`, `home.title`, `home.empty`, `library.title`, `library.empty`, `search.title`, `search.empty`
Flow: `web/e2e/auth.spec.ts` (sign up → Home → tabs → a reload keeps the session → avatar → sign out → signed out again)
- [x] Web  - [ ] iOS  - [ ] Android

### Error codes of the access flow
The data layer reports stable codes, never sentences (`app/data/auth.ts`, `AuthErrorCode`); the copy lives under `auth.error.<code>`: `invite_required`, `invite_invalid`, `invite_expired`, `invite_exhausted` (Sign up), `invite_gone` (Verify), `code_invalid` (Verify), `rate_limited` (resend), `email_invalid`, `not_configured`, `unknown`.

<!-- Filled as the screens land: Search (#6, #12), Book detail and the
     Add / Finish / Abandon sheets (#6, #7, #9, #10, #11), Home (#8), Manual book (#13),
     Library and Collections (#14), offline states (#15). #16 completes the set. -->
