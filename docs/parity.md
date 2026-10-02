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

### Start  (web: `app/pages/index.vue`)
Purpose: scaffold placeholder that proves the shell boots; replaced by the tab shell and sign-in (#3).
States: content
Actions → result: none
Copy keys: `app.name`, `start.tagline`
IDs: `start.title`, `start.tagline`
Flow: `web/e2e/smoke.spec.ts`
- [x] Web  - [ ] iOS  - [ ] Android

<!-- Filled as the screens land: Sign in, Sign up, Verify (#3), Search (#6, #12), Book detail and the
     Add / Finish / Abandon sheets (#6, #7, #9, #10, #11), Home (#8), Manual book (#13),
     Library and Collections (#14), offline states (#15). #16 completes the set. -->
