# App update: "Update now" is a dead end, and the sheet should go — assessment

Date: 2026-11-18. Status: diagnosis confirmed in code; change not yet implemented.

## Cause (exact)

`applyUpdate` (`web/app/utils/appUpdate.ts:172-178`) reloads **unconditionally**:

```ts
if (!deps.registration?.waiting) await deps.check()
if (deps.registration?.waiting) { await deps.activateWaiting(); await sleep(4s) }
deps.reload()
```

With `outdated` true (server's `_nuxt/builds/latest.json` id differs from the running
page's `useRuntimeConfig().app.buildId`) but **no waiting worker**, the middle branch is
skipped and the last line still runs `window.location.reload()`. The reloaded page runs the
same old build (the old worker's precache answers `/` via `navigateFallback: '/'` until a new
worker activates), so `check()` finds the same newer id again, `outdated` is true again, and
the sheet re-raises — because `available = waiting || outdated`
(`web/app/stores/appUpdate.ts:38`) and `pending` derives from `available`. Pressing "Update
now" 50 times reloads the same old shell 50 times. That is the reported behaviour exactly.

The test suite even pins the bug as intended behaviour:
`web/tests/app-update.test.ts:237-242` — "still reloads with no worker to activate".
That assertion must be deleted with the change, not weakened silently (it names the dead end).

## What makes it eventually succeed (code-read, not yet reproduced live)

- `checkForUpdate` (`web/app/utils/appUpdate.ts:116-155`) calls `registration.update()` up to
  twice per look: once at the start, and once more when `outdated && !waiting && !installing`
  (comment: "the file and `latest.json` change together, but the browser may have checked
  `sw.js` a moment before the deploy finished").
- "2–3 minutes then it works" is therefore not the 4 s `RELOAD_FALLBACK_MS` (that only delays
  the same useless reload). It is a later `registration.update()` — on a subsequent check
  (foreground return, online event, 30-min interval) or the browser's own worker check —
  finally fetching and installing the new `sw.js`. The next press then finds
  `registration.waiting`, posts `SKIP_WAITING` via `$pwa.updateServiceWorker(true)`, and takes over.
- Deploy ordering (`latest.json` vs `sw.js`): **not proven from the repo**. No generator for
  `builds/latest.json` was found in `web/` (only its reader and tests); both files ship with
  the same Cloudflare Pages build of the `production` branch, so they go live together, but
  whether the id can lead the worker by seconds on the CDN edge was not measured. The code
  already assumes they "change together" (the comment above) and re-asks once for exactly
  that skew. The dead end does not depend on the ordering: whenever id-leads-worker happens,
  every press is a no-op reload.
- iOS/Safari (target platform): an installed PWA resumes without navigation, and the browser
  only looks for a new `sw.js` on its own schedule. So the `outdated`-without-worker state —
  the exact state in which "Update now" cannot work — is the *normal* state there for minutes,
  which is why she lives in it.

Hypothesis verdict: **holds**. `outdated` alone opens the sheet, and the sheet offers an update
that cannot be applied until the worker arrives on its own.

## What was checked

- `stores/appUpdate.ts`, `utils/appUpdate.ts`, `plugins/app-update.client.ts`, `UpdateSheet.vue`,
  `tabs.vue` mount, `Account.vue` rows/status/`reopen`, `nuxt.config.ts` pwa block
  (`registerType: 'prompt'`, `clientsClaim: true`, no `skipWaiting`), `useWhatsNew.ts`,
  `utils/changelog.ts` (`shouldShowNotes`), `app-config.release` embedding (build time from
  `version.txt` + `CHANGELOG.md`), `app-update.test.ts` + `changelog.test.ts`, `parity.md`
  "App update". No live two-build reproduction was run; the flow is hard to e2e and the brief
  allows saying so.

## Plan (the brief's four parts)

1. **Sheet gone.** Delete `UpdateSheet.vue` + mount (`tabs.vue`), `pages/prototype/update-sheet.vue`,
   store surface (`sheetOpen`, `pending`, `open`, `dismiss`, `dismissed`, `reopen`, `updateShow`
   call site), the sheet-raising half of `plugins/app-update.client.ts`, and `canInterrupt` /
   `isTyping` / `useModalShown` usage that existed only for it (verify `useModalShown` still
   needed elsewhere before deleting — it is: `TabBar`, `useEditionChange`, `useSettled`).
   Remove `update.*` i18n keys from `en.json` + `de.json`; `pnpm i18n:verify` proves it.
2. **Background, no interruption.** `outdated`-without-worker must trigger
   `registration.update()` and wait, never reload into the same shell. Reload only when nobody
   notices (next cold start is free; otherwise a `visibilitychange`-to-hidden window — never on
   a timer, never with a sheet/reader/field/palette open). Keep `prompt` + no `skipWaiting`
   question open: `skipWaiting` + `clientsClaim` takes over at once but page still runs old
   chunks against new files (#341, `reader-stale-chunk.spec.ts` must still pass) — decision goes
   in the implementation commit.
3. **Profile → version stays.** Keep manual `check({ manual: true })` + `profile.account.update*`
   keys; a manual trigger must end with the new version running (check, then reload only once a
   new worker is active), with a busy state until the page comes back. Delete `updateShow`/`reopen`
   path with the sheet.
4. **What's new.** Keep `useWhatsNew`; it already keys off the *running build's* embedded
   `appConfig.release` + `libellus:whatsNew`, so notes can only show for the version actually
   running — verify `shouldShowNotes` hole is closed (an older build cannot show a newer
   version's notes since notes come from its own build; confirm in test). Manual entry stays.

Constraints respected: no new dependency, no migration, no dependency bump, no forced refresh
while in use, sync/offline untouched, `reader-stale-chunk.spec.ts` stays green, privacy unchanged.
New tests: store rules (no sheet; `outdated` refreshes worker, never reloads same build;
`apply()` reloads only with active worker — incl. a "press 50 times" regression test) +
`whatsnew`-after-update.
