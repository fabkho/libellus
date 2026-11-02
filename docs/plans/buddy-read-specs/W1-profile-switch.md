# W1 · The Buddy reads switch in Profile → Account

**Repo / branch:** libellus, `feat/buddy-reads-switch` off `origin/main`. **Tier:** normal. **Size:** S. **Depends on:** nothing. Behind it the whole feature will sit at first (plan part 9.1).

## Task

Add a device setting **Buddy reads**, **off by default** in the first release, in Profile → Account, built as the twin of the Friends tab's switch. It gates nothing yet (no entry points exist); later PRs read it. Read first: `web/app/utils/friendsTab.ts`, `web/app/stores/friendsTab.ts`, `web/tests/friends-tab.test.ts`, `web/app/components/profile/Account.vue` (the row at line 239: `<UiSwitchRow v-model="showFriendsTab" icon="people" :label="t('profile.account.friendsTab')" testid="profile.friendsTab" />`, and the store wiring at lines 64–66), `web/app/stores/session.ts` (how sign-out calls `friendsTab.reload()`), `docs/parity.md` entry "Tab shell" / "The Friends tab" (line 94), `web/app/data/localData.ts` (`LOCAL_DATA_PREFIX`).

## Change

1. `web/app/utils/buddyReadsSwitch.ts` (framework-free): `BUDDY_READS_KEY = `${LOCAL_DATA_PREFIX}buddyReads``, `parseBuddyReads(raw)` (**only an explicit `on` is on; nothing or anything unknown is off**), `readBuddyReads(storage)`, `writeBuddyReads(storage, on)` (off is stored as nothing: remove the key; on stores `on`), the same try/catch against unavailable storage as `friendsTab.ts`. A single exported constant `BUDDY_READS_DEFAULT_ON = false` is what a later release flips (and `parse` honours it).
2. `web/app/stores/buddyReadsSwitch.ts` (Pinia, the twin of `stores/friendsTab.ts`): `enabled`, `set(on)`, `reload()`; and `canTurnOff` as a `ref<boolean>(true)` that a later PR sets to false while the member is in an active room (the store only holds it; `set(false)` returns false and changes nothing while `canTurnOff` is false). `session.ts` calls `reload()` on sign-out like the Friends tab.
3. `web/app/components/profile/Account.vue`: a `UiSwitchRow` below the Friends tab row, icon `people` (or the nearest existing icon), `profile.account.buddyReads`, testid `profile.buddyReads`, with a one-line hint underneath (if `UiSwitchRow` has no hint slot, a footnote line as `PrivacySheet.vue:90` does): EN "Read one Book with friends. Its other members see which Section you are in, never your page." DE (run `pnpm i18n:translate` and read the result): "Ein Buch mit Freunden lesen. Die anderen Mitglieder sehen, in welchem Abschnitt du bist, nie deine Seite."
4. `web/i18n/locales/en.json` + `de.json` + `web/.i18n-kit.lock.json`: keys `profile.account.buddyReads`, `profile.account.buddyReadsHint`. Run `pnpm i18n:translate`, read the diff, commit all three files.
5. `docs/parity.md`: a paragraph beside the Friends tab's: where the row is, default off, device-local like the Friends tab (not across devices), forgotten on sign-out, what it will gate (the Book page row, the Home card, invitations and the routes `/together/*`, `/t/*`), and "turning it off while in an active room is refused: leave first" as *planned* (the store hook exists; the confirm arrives with the room screens).

## Not in it

Any entry point, route, RPC call or data layer; the "Leave first" confirm sheet; any e2e flow. Do not touch `privacy.ts`, the `privacy.never` key, `README.md` (P1 owns them).

## Constraints

- No Supabase call; framework-free utils in `app/utils`, store in `app/stores` (`web/AGENTS.md`: page → store → repository; here no repository is needed because nothing is fetched).
- Default **off**; a corrupt stored value reads as off; storage unavailable reads as off and the choice holds for the visit.
- The row must not shift the layout at 360 px (`docs/DESIGN.md`); 44 px target; keyboard and VoiceOver name it ("Buddy reads, switch").
- Conventional title: `feat(web): the Buddy reads switch in Profile → Account` (release-please writes the notes from it).

## Ownership

You own `web/app/utils/buddyReadsSwitch.ts`, `web/app/stores/buddyReadsSwitch.ts`, `web/tests/buddy-reads-switch.test.ts`, the `profile.account.buddyReads*` keys, the new row in `web/app/components/profile/Account.vue`, the one-line hook in `web/app/stores/session.ts`, a paragraph in `docs/parity.md`.

## Tests

Vitest (`pnpm test` in `web/`, plain Node; the stores branch on `import.meta.client`, see the `libellus-stores-are-client` plugin in `web/vitest.config.ts`: add `buddyReadsSwitch` to its regex): default off; `on` reads back on; a corrupt value reads off; storage that throws reads off; sign-out `reload()` forgets it; `set(false)` is refused while `canTurnOff` is false. No Playwright flow (not a critical path), no pgTAP.

## Observable acceptance

- Profile → Account shows the **Buddy reads** row in English and German, off on a fresh device; it toggles at once, survives a reload, and is off again after sign-out and in a new browser profile.
- `pnpm test` green; `pnpm i18n:verify` green; `docs/parity.md` has the entry.
