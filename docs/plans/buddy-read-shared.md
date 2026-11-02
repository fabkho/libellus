# Buddy reads, shared with Trappist: the build plan

**Status: the build plan (phase 2), for the coordinator and the owner. Documentation only.** Written 2 November 2026
against Libellus `origin/main` `78e974e4` (1.31.0), Trappist `07eab300` (1.30.4, read only), `@fabkho/ui`
`origin/main` `11dd8ab` (0.10.6). The phase-1 findings (what Trappist has, the sharing map, what changed in
BetterReads, the 20 questions) are unchanged and moved to [Appendix A](#appendix-a-phase-1-findings-unchanged). The
paste-ready specs of the first four pull requests are in [`docs/plans/buddy-read-specs/`](buddy-read-specs/).
Draft PR #468, **DO NOT MERGE**.

Paths without a repo prefix are this repository; `trappist:` and `ui:` paths are read only. "Spike" is the 2 November
experiment in `/tmp/spike` (part 2). What I could not verify is said where it comes up and collected in part 10.

## 0. What the owner decided

All 20 phase-1 recommendations stand. The notes the owner added, and where this plan handles them:

| Decision | Where |
|---|---|
| Public repo `fabkho/chat`, MIT, tag-pinned git dependency like `@fabkho/ui` | S4–S6, part 2 |
| **Her Section is visible to the other members of a buddy read she joined, automatic from her reading progress with a hand override.** The old promise "progress never leaves a member's own account" is wrong and is removed | part 5 (design), part 6 (every place that says it, with EN/DE replacements), P1 |
| A worker may edit Trappist (prep and split), **every change a draft PR for the owner's review; nothing merges without the owner** | S1–S3, S5; Trappist PRs stack on each other (part 3) |
| KLIPY GIFs after the first release; the owner creates the key | K1, [owner actions](#owner-actions) O4 |
| Name "Buddy read" (EN) / "Buddy-Read" (DE); entry on the Book page and a Home card, behind a Profile → Account switch at first | W1, W5 |
| Libellus database work starts **now**, in parallel with the Trappist and package work | part 3, part 8 |

## 1. The plan in one screen

Four tracks. Sizes are one worker's days, tests and docs included (S < 0.5, M ≈ 1, L ≈ 2–3). "Opus" is at most one at a time.

| # | PR | Repo | Size | Tier | Starts after |
|---|---|---|---|---|---|
| **D1** | Database: buddy reads, members, Sections | libellus | L | **Opus** | nothing: **start now** |
| **S1** | Chat layer prep: `threadId`, `inviteState` out | trappist (draft) | M | normal | nothing: **start now** |
| **W1** | The Profile → Account switch | libellus | S | normal | nothing: **start now** |
| **P1** | The progress promise removed, privacy text | libellus | M | normal | nothing: **start now**; merged with the release |
| D2 | Database: Section from reading progress, co-member view | libellus | M | normal (high) | D1 |
| S2 | Chat layer: the Realtime core | trappist (draft) | M | normal | S1 |
| S3 | Chat layer: photo, KLIPY client, error codes | trappist (draft) | M | normal | S1 |
| D3 | Database: messages, reactions, delete, reports | libellus | L | **Opus** | D1 (after D1 frees the Opus slot) |
| S4 | `fabkho/chat` 0.1.0 (new repo) | fabkho/chat | M | normal | S2, S3, owner action O1 |
| D4 | Database: live updates (per-member topics) | libellus | M | normal (high) | D2, D3 |
| S5 | Trappist takes `@fabkho/chat` | trappist (draft) | S | normal | S4 released |
| S6 | Libellus takes `@fabkho/chat` | libellus | S | normal | S4 released |
| W2 | Data layer, store, live | libellus | L | normal | D1–D4, S6 |
| W3 | Set up, invite, join by link | libellus | L | normal | W2, W1 |
| W4 | The room, a Section's thread, finish | libellus | L | normal | W2, D3 |
| W5 | Book page row and Home card | libellus | S | normal | W3 |
| — | **Release 1**, behind the switch (part 9) | libellus | — | — | D1–D4, S6, W1–W5, P1 |
| K1 | GIFs from KLIPY | libellus | M | normal | release 1, owner action O4 |
| X1–X3 | Later: reply push, ebook TOC and saved lists, photos | libellus | each M–L | per spec | release 1, owner decisions |

**Start now, in parallel (four workers, one Opus):** D1 (Opus), S1 (Trappist, Sonnet), W1 (Sonnet), P1 (Sonnet).
Their files do not overlap (part 8). When D1 is done, D3 takes the Opus slot, D2 starts on D1's branch.

**The first release** can be cut when D1–D4, S6, W1–W5 and P1 are merged and a staging check (part 9) passed: about
three weeks of work if the Trappist reviews keep pace (an estimate, not a promise: it is bounded by the owner's review
of the Trappist PRs and by D1 and D3 running one after the other on the Opus slot).

<a id="owner-actions"></a>
### Owner actions

These cannot be done by a worker. Dates are estimates from the order above, counted from Monday 2 November 2026.

| # | Action | Needed by | Why |
|---|---|---|---|
| O1 | Create the **public** repo `fabkho/chat` (MIT), in Settings → Actions → General allow "Actions to create and approve pull requests" (release-please needs it, as for `fabkho/ui`'s `release.yml`). Or tell the coordinator a worker may run `gh repo create fabkho/chat --public` | before S4: about Fri 6 Nov | a worker cannot create repositories under your account without your word |
| O2 | Review and merge the Trappist draft PRs S1, S2, S3, S5 in order (they stack; S4's import is cut from the tip of S3) | S1: about Wed 4 Nov; S3: about Mon 9 Nov | nothing merges in Trappist without you |
| O3 | **Supabase dashboard, hosted project: Realtime → turn off "Allow public access"** (old plan §H; the exact label is from memory, not checked), after D4 is merged and before release 1 | before release 1 | the per-member topics are private channels; with public access on, a client could join a public channel; check that the import job's live feed (`postgres_changes`, `web/app/data/importJobFeed.ts`) still works on staging first |
| O4 | **Create a KLIPY app key for Libellus** in KLIPY's Partner Panel (a new app, "Powered by KLIPY", the strictest content filter), then set `NUXT_PUBLIC_KLIPY_KEY` in Cloudflare Pages (production and preview) and in CI | after release 1, before K1: by Mon 30 Nov | K1 cannot be tested against the live API without it; tests use recorded answers and do not need it |
| O5 | Decide staging (#177) before release 1: recommendation in part 9 | before release 1 | part 9 |
| O6 | Read and approve the EN/DE wording of P1 (privacy notice, Privacy sheet, README) | before P1 merges | it changes a promise in the privacy notice; `docs/legal-checklist.md` says the notice is a draft, not legal advice |
| O7 | Close draft PR #333 (the old plan) once #468 is accepted | any time | it says "What never leaves … her progress" and "copy from Trappist" |

## 2. The spike (what works, what breaks, the exact configuration)

Run on 2 November 2026 in `/tmp/spike` (outside every repository), pnpm 12.6.0, Node 24.21.0, Nuxt 4.6.3, Vue 3.5.44, no
`GITHUB_TOKEN` / `GH_TOKEN` / `GIGET_AUTH` in the environment. The test app mirrors BetterReads' setup: a Nuxt 4 SPA
whose `nuxt.config.ts` is `extends: [uiLayer(), chatLayer()]` with the same two-line helper as `web/ui.config.ts`, pnpm git
dependencies pinned to a tag, `pnpm-workspace.yaml` with `allowBuilds: { esbuild: true }` as in `web/pnpm-workspace.yaml`.

**A. The public-repo route is proven, with no token.**
- `pnpm install` with `"@fabkho/ui": "github:fabkho/ui#v0.10.6"` fetched `https://codeload.github.com/fabkho/ui/tar.gz/11dd8ab…`
  (the lockfile says so) in 4.6 s with no credentials, and `nuxt generate` built a page using `UiButton`.
- The package's `files` allowlist is honoured for a git-hosted package: `node_modules/@fabkho/ui` holds `app`, `modules`,
  `nuxt.config.ts`, `testing`, `package.json`, `README.md`, `LICENSE`, not the stories or tests (`ui:package.json`, `files`).
- Libellus CI installs it the same way: `pnpm install --frozen-lockfile` (`.github/workflows/ci.yml:313`, and the web build
  job at `:392`/`:405`) with `pnpm/action-setup` and Node 24, and no secret for `@fabkho/ui`. Cloudflare Pages builds
  `pnpm generate` in `web/` with `NODE_VERSION=24` and the one secret `GIGET_AUTH`, which is Regal's (`docs/HOSTING.md`,
  the settings table). **A public `fabkho/chat` needs no new secret in either place.** (Not tried here: a real
  Cloudflare build; the absence of any token for `@fabkho/ui` in `docs/HOSTING.md` is the evidence.)
- `pnpm install --frozen-lockfile` on the spike app exits 0.

**B. Variant A, a standalone layer repo as a git dependency, works** (the recommendation).
- Layer repo (a local git repo with a `v0.1.0` tag standing in for `fabkho/chat`): `nuxt.config.ts` =
  `export default defineNuxtConfig({ $meta: { name: 'chat' } })`, `package.json` with `"main": "./nuxt.config.ts"`,
  `"exports": { ".": "./nuxt.config.ts", "./*": "./*" }`, `"files": ["app", "nuxt.config.ts"]`.
- App `package.json`: `"@fabkho/chat": "git+file:///tmp/spike/chat-layer#v0.1.0"`. The GitHub form is
  `github:fabkho/chat#v0.1.0`; **I could only try the `file://` form, because the repo does not exist yet.** The
  mechanism (a git ref, `files` honoured, `#layers/chat` from `$meta.name`) is the same one that carries `@fabkho/ui`.
- App `nuxt.config.ts`: `extends: [uiLayer(), chatLayer()]` with `chatLayer = () => process.env.CHAT_LAYER || '@fabkho/chat'`
  (the `UI_LAYER` override pattern of `web/ui.config.ts`).
- Result: `nuxt generate` succeeded; `#layers/chat/app/utils/queue` and a composable under `#layers/chat/app/composables/`
  imported from a page and landed in the client bundle; the `#layers/chat` alias came from `$meta.name`, exactly as
  `#layers/ui` does today (`web/vitest.config.ts` maps both for Vitest, so `#layers/chat` gets the same one-line alias).
- **The peer dependency trap.** A layer file importing `@fabkho/ui/pure/timeline` (as `trappist:web/layers/chat/app/utils/thread.ts` does)
  built fine, but with `"peerDependencies": { "@fabkho/ui": ">=0.10.6" }` pnpm reported `unmet peer @fabkho/ui`
  (`pnpm peers check` fails): the app's copy is a git URL, not a semver, so no range matches, and pnpm did not link `@fabkho/ui`
  into the chat package. With `"@fabkho/ui": "*"` the warning is gone and pnpm links it (`node_modules/.pnpm/@fabkho+chat…/node_modules/@fabkho/ui`).
  **Decision: `fabkho/chat` declares `"@fabkho/ui": "*"` as a peer** (or inlines the 4-line `compareCreated`, which is
  the alternative; `ui:app/utils/chat/timeline.js:166`).
- **Bump.** `pnpm add -E "@fabkho/chat@git+file:///tmp/spike/chat-layer#v0.1.1"` changed only `package.json` and
  `pnpm-lock.yaml` and the new code was in the next build. `.github/scripts/ui-bump.sh` relies on exactly this (it fails if
  anything else changed). It also moved the dependency to the top of the object, a cosmetic diff.

**C. Variant B′, the layer as a sub-folder of another package, works only with an explicit file path** (not recommended).
Simulated with a local package `@sim/ui` that has `chat/nuxt.config.ts` and `chat` in `files` (the real `@fabkho/ui` has no
such folder, so this is a simulation, not a test against it):
- `extends: ['@sim/ui', '@sim/ui/chat']` fails: `WARN Cannot extend config from @sim/ui/chat`, then the build stops on the missing `#layers/chat` alias.
- `extends: ['@sim/ui', '@sim/ui/chat/nuxt.config.ts']` and `['@sim/ui', './node_modules/@sim/ui/chat']` work, and `#layers/chat` resolves.
- `'@sim/ui/chat/'` fails (Node's deprecated trailing-slash export pattern).
- pnpm's subdirectory selector works too: `"@sim/chat": "git+file:///tmp/spike/mono#v0.2.0&path:/chat"` installed only the
  sub-package and built. Not tried with GitHub.
- Verdict: possible, with a quirk (`…/nuxt.config.ts`) every consumer must know; no release-train saving that matters. Stay with a separate repo.

**D. What I did not test.** A build on Cloudflare Pages; a GitHub-hosted `github:fabkho/chat#vX` install (the repo does not
exist); `git subtree split` on Trappist (S4 uses a squashed import instead, below); the entry-chunk guard for Realtime (part 3, S6).

**E. `ui-bump.yml` generalised.** Today `.github/scripts/ui-bump.sh` hard-codes `UI_REPO=fabkho/ui`, reads the pin
`github:fabkho/ui#vX.Y.Z` from `web/package.json`, asks `gh api repos/$UI_REPO/releases/latest`, runs
`pnpm add -E "@fabkho/ui@github:$UI_REPO#$latest"`, requires that only `web/package.json` and `web/pnpm-lock.yaml`
changed, opens `chore/ui-bump-<tag>` and dispatches `ci.yml -f flows=false`. To take a second package: parametrise by
`PKG` (`@fabkho/ui` with repo `fabkho/ui`, `@fabkho/chat` with `fabkho/chat`), loop over both in the workflow (a matrix of two
jobs, so two independent PRs `chore/ui-bump-<tag>` and `chore/chat-bump-<tag>`), key the branch and the "already has a
pull request" check by package. Cheap: about 25 changed lines, done in S6 and mirrored in S5 for Trappist's own
`.github/workflows/ui-bump.yml` (it exists there). One package per PR keeps a bad release of one from blocking the other.

## 3. The pull requests, in dependency order

Conventions that apply to every Libellus PR (from `AGENTS.md`, `web/AGENTS.md`, `CONTRIBUTING.md`, `docs/TESTING.md`):
conventional commit titles (release-please writes the notes from them: a `feat:` subject is written for members);
**database changes ship with pgTAP** (`supabase test db`, runs in the PR's `check` job) and a **regenerated
`supabase/schema-snapshot/`** (`pnpm schema:snapshot` from `web/`, local stack up and migrated; CI fails on a stale one); an applied
migration is never edited; every changed screen gets a `docs/parity.md` entry and EN + DE strings (`en.json`, then `pnpm i18n:translate`,
both files and `.i18n-kit.lock.json` committed); **pull requests run no Playwright flows** — only `check`; adding the label `full-e2e`
runs every flow early, and the release run reads them all (`docs/TESTING.md`, "CI: what runs when"); a new flow only for a critical path
(a buddy read is a new social loop: one flow, in W4); no full typechecks.
Trappist PRs follow that repo's conventions (its `AGENTS.md`, `web/AGENTS.md`, `docs/CI.md`: no new e2e) and are opened as **drafts**.

Trappist's PRs **stack**: nothing merges there without the owner, so S2 is based on S1's branch and S3 on S2's. S4 is cut
from the tip of S3. If the owner changes an earlier PR, the later ones are rebased by the same worker.

### Track S: sharing the chat layer

**S1 · `refactor(chat): the layer's own names, and the Trappist parts out`** — trappist, branch `refactor/chat-layer-names`, draft.
- *Scope:* `web/layers/chat/app/**` and the Trappist code that calls it. (1) Rename the field `chapterId` → `threadId` in `ChatRecord`, `SendJob`, the `ChatAdapter` queries and the layer's own helpers
  (`threadKey(conversation, thread)`, `thread.ts`, `useThread.ts`, `veil.ts` where it takes a chapter id) in `layers/chat/app/types/adapter.ts` and `layers/chat/app/**`. **The type names `BuddyChapter`, `BuddyReadData`, `ChapterPlan` and the functions `chapterOpen`/`chapterView` keep their names**
  (a chapter *is* a Section for Libellus; the layer has no words and its README says so in S4); only the id field is neutral. The app's own database column `chapter_id` and `Message.chapterId` stay, mapped at the adapter boundary (`app/data/chat.ts` `toMessage`, `app/data/buddyReads.ts`, `app/stores/chat.ts`).
  (2) `layers/chat/app/utils/inviteState.ts` and `web/tests/chat-layer-invite-state.test.ts` move into the app, next to their only users (`app/components/feed/FeedBookChat.vue`, `app/components/feed/callChat.ts`); the `InviteAdapter` interface stays. (3) The guard `web/tests/chat-layer.test.ts` lists the layer's files; update it.
- *Not in it:* any behaviour change, the Realtime core, photo, KLIPY, the database.
- *Tests:* Vitest `pnpm --dir web test:unit` (the 7 `chat-layer*.test.ts` files, 1,348 lines, plain Node) and the store tests that touch threads
  (`chat-store-groups`, `chat-store-buddy`, `chat-groups`, `buddy-reads`) must stay green **unchanged except for the renamed field**; no pgTAP, no flows.
- *Docs:* `docs/plans/groups.md` "Port to BetterReads" gets the renamed field (the only doc that names it).
- *Migration:* none. *Tier:* normal. *Size:* M (a wide find-and-replace; the risk is a missed `chapterId` at the boundary).
- *Depends on:* nothing. *Risk:* a missed mapping silently drops the thread id of a chapter comment. *Acceptance:* all listed suites green;
  `grep -rn "chapterId" web/layers/chat` empty; a manual look: a chapter comment still arrives in its thread (the store tests prove it).

**S2 · `refactor(chat): the Realtime core into the layer`** — trappist, branch `refactor/chat-layer-live`, draft, on S1.
- *Scope:* new `web/layers/chat/app/utils/liveChannel.ts` (framework-free): `liveChannel({ loadRealtime, supabaseUrl, anonKey, token, topic,
  parse(event, payload), onEvent, onStatus, onResync })` with the mechanics now in `app/data/realtime.ts` (join a private topic, `ChannelStatus`,
  resync on rejoin, `COLD_START_RESYNC_MS` = 3 s cold-start resync, `refused`) and the mechanics now in `app/stores/realtime.ts` lines ~50–196 (replace a channel
  that is not live on `online`/`visibilitychange`, one revival at a time, `revivedAt` guard). `loadRealtime` is **injected** so an app that aliases
  `@supabase/realtime-js` to a stub reaches the real client through its own door. `app/data/realtime.ts` keeps `RealtimeEvent`, `toRealtimeEvent` and the
  Feed/connection events and calls the core; `app/stores/realtime.ts` stays Pinia over it. Move the mechanical tests of `tests/realtime.test.ts` (244 lines) to
  `tests/chat-layer-live.test.ts`; extend the guard to the new file (no `@supabase/realtime-js` import in the layer).
- *Not in it:* the event union, Pinia, any new event, the database.
- *Tests:* Vitest unit (plain Node, fake timers/channel, as `realtime.test.ts` does today): rejoin → one resync; first join → resync after 3 s once; dead socket
  on `online` and on visible → replaced once; two triggers at once → one revival; `refused` → no retry; sign-out → stopped; stale callbacks of an older channel ignored.
  pgTAP `realtime_test.sql` (377 lines) untouched and green. No flows.
- *Docs:* `docs/parity.md` Realtime note if it names the file; `web/AGENTS.md` layer rules (one line: "the layer never imports realtime-js").
- *Tier:* normal (Sonnet high); promote to Opus only if the existing tests cannot be kept meaningful. *Size:* M. *Depends on:* S1.
- *Risk:* **the iOS-PWA suspend fix cannot be tested in CI**; the unit tests pin the logic, the owner checks one real phone (background the PWA for a minute, return, a message arrives).
  *Acceptance:* every existing realtime test still passes against the moved code; Trappist's chat still updates live on the owner's phone after a background/foreground cycle.

**S3 · `refactor(chat): photo, the KLIPY client and the error codes into the layer`** — trappist, branch `refactor/chat-layer-utils`, draft, on S2.
- *Scope:* `app/data/photo.ts` (177 lines, already framework-free) → `layers/chat/app/utils/photo.ts` (re-exported at the old path, as `saveQueue.ts` is);
  `app/data/klipy.ts` (244 lines) → `layers/chat/app/utils/klipy.ts` with `locale`, the topic list and the failure
  words injected (today `LOCALE = 'de'`, `GIF_FEEDS`/`TOPIC_QUERIES` with German chips, `translateChatError`), `KLIPY_MEDIA_HOST` kept; the SQL error-code list
  (`CHAT_ERROR_KEYS` / the keys in `RULES`, `app/data/chat.ts` ~lines 160–252) → `layers/chat/app/utils/errors.ts` as **codes only** (`message_rate_limited`, `message_client_id_reused`,
  `message_chapter_unavailable` → neutral names kept as the SQL raises them, `buddy_read_archived`, …); Trappist's sentences stay in `app/data/chat.ts`. Tests move with the files
  (`tests/klipy.test.ts` 282 lines with recorded answers, `chat-media.test.ts` photo parts).
- *Not in it:* Libellus' error codes (they are Libellus', added in W2), `storageCache.ts`, the repository.
- *Tests:* Vitest unit; recorded KLIPY answers untouched; `hasMetadata`/`stripJpegMetadata` tests untouched; the guard extended. pgTAP unchanged.
- *Docs:* none beyond the layer README stub added in S4. *Tier:* normal. *Size:* M. *Depends on:* S2 (guard and file list).
- *Acceptance:* `pnpm --dir web test:unit` green; the Feed's photo post and a GIF still work in the app (both use these modules); the layer has no German string (`grep -rn "[äöüß]" web/layers/chat` empty).

**S4 · `fabkho/chat` 0.1.0, the new repository** — repo `fabkho/chat` (owner action O1), branch `main`/`feat/import`.
- *Scope:* **a squashed import, not a subtree split**: one commit "feat: import of trappist `web/layers/chat` at `<sha of S3's tip>`" (a split would carry Trappist's
  private PR numbers and commit subjects into a public history). Contents: `app/**`, `nuxt.config.ts` (`$meta: { name: 'chat' }`), `package.json` (`name: @fabkho/chat`,
  `type: module`, `main`/`exports` as in the spike, `files: ["app","nuxt.config.ts"]`, `peerDependencies`: `@fabkho/ui: "*"`, `nuxt`, `vue`; `devDependencies`: `vitest`, `@fabkho/ui` as a tag pin for the tests),
  `LICENSE` (MIT), `README.md` (what it is, the adapter contract from `app/types/adapter.ts`, how an app takes it: `extends`, the `#layers/chat` alias, the
  `CHAT_LAYER=/path` override, the rule "no words, no app imports, no Supabase, no realtime-js"), `release-please-config.json` + `.release-please-manifest.json` + `.github/workflows/release.yml`
  (copies of `fabkho/ui`'s: `include-v-in-tag`, `bump-minor-pre-major`, the PR header text saying which pin to change), `.github/workflows/ci.yml` (pnpm install frozen, `pnpm test`; no stories, no axe),
  the layer's tests moved from Trappist (`tests/chat-layer*.test.ts`, imports rewritten from `#layers/chat/…` to relative paths) and the guard `tests/layer-guard.test.ts` (rule: imports only itself, `vue`, `@fabkho/ui/pure/*`; no auto-imports; no Trappist/BetterReads domain words).
- *Not in it:* any app code, SQL (a `reference/sql/` folder is option 5 of the appendix's part 2(c); **decided: not in 0.1.0**).
- *Tests:* Vitest, plain Node, on the new repo's CI. *Docs:* the README. *Tier:* normal. *Size:* M. *Depends on:* S2, S3, O1.
- *Acceptance:* CI green; merging release-please's PR tags `v0.1.0` and creates the GitHub release; `pnpm add -E github:fabkho/chat#v0.1.0` installs in a scratch app with no token and `nuxt generate` resolves `#layers/chat/app/utils/queue` (the spike's check, repeated against GitHub).

**S5 · `chore(web): take the chat layer from @fabkho/chat`** — trappist, branch `chore/chat-package`, draft, on S3.
- *Scope:* `web/package.json` (`"@fabkho/chat": "github:fabkho/chat#v0.1.0"`, exact), `web/chat.config.ts` (the `ui.config.ts` twin), `nuxt.config.ts` `extends: [uiLayer(), chatLayer()]`, delete `web/layers/chat/`, `web/vitest.config.ts`
  alias `'#layers/chat': process.env.CHAT_LAYER || resolve('./node_modules/@fabkho/chat')`, delete the moved tests and the guard (now in the package), `.github/workflows/ui-bump.yml` + `.github/scripts/` generalised as in part 2 E, `web/AGENTS.md` (the layer rules point at the package README), `docs/plans/groups.md` (status line).
- *Tests:* Vitest unit + component projects, all chat suites green; a build (`pnpm --dir web build`). No flows.
- *Tier:* normal. *Size:* S. *Depends on:* S4 released. *Risk:* the alias or a missing `files` entry; the spike covered both. *Acceptance:* the app builds and the chat suites pass with `web/layers/chat` gone.

**S6 · `feat(web): take @fabkho/chat`** — libellus, branch `feat/chat-package`.
- *Scope:* `web/package.json` (+ `pnpm-lock.yaml`), `web/chat.config.ts`, `web/nuxt.config.ts` `extends: [uiLayer(), ...regalLayer(), chatLayer()]`, `web/vitest.config.ts` alias `#layers/chat`,
  `.github/scripts/ui-bump.sh` + `.github/workflows/ui-bump.yml` for two packages (part 2 E), `docs/DEVELOPMENT.md` "The UI base bump" (now "The package bumps"), `web/AGENTS.md` (a bullet beside "The shared UI base"),
  `web/tests/chat-layer.test.ts` (`#layers/chat` resolves, the layer is registered once, nothing of the app shadows it, in the style of `tests/ui-layer-shadow.test.ts`),
  and **the entry-chunk guard**: a build-time check beside `regalContainment` (`web/regal.config.ts`) or a Rollup `generateBundle` hook that fails the build if any chunk listed as entry by `index.html` contains `@supabase/realtime-js`
  modules (the stub is allowed); `web/perf/bundle.ts` already prints the entry's files, and its output is the second check. **Not spiked: the exact hook; the PR proves it by failing once on purpose.**
- *Not in it:* any use of the layer (W2 is the first). *Tests:* Vitest (`pnpm test`, needs the stack), `ui-bump.sh` with `DRY_RUN=1`, a full `pnpm generate`. *Docs:* DEVELOPMENT.md.
- *Tier:* normal. *Size:* S. *Depends on:* S4 released. *Acceptance:* `pnpm generate` green with `LIBELLUS_REGAL=1` unset and set; entry chunk byte-identical in size class to `main` (within 1 KB: the layer is unused); `DRY_RUN=1 .github/scripts/ui-bump.sh` prints a plan for each package.

### Track D: the database (starts now, independent of the package)

The migrations are numbered after the latest on `origin/main`, `20261112010000_hardcover_covers.sql`; **renumber if `main` moves on before they merge**.
All use the house rules (`AGENTS.md`, "The database"; part 4 has the design): RLS on every new table, `revoke all … from anon, authenticated` (this repo's default
privileges grant everything, `supabase/schema-snapshot/grants/default-privileges.sql`, so the revoke is explicit, as in `20261002190000_invites_and_accounts.sql:58`), `security definer`
RPCs with a pinned `search_path = pg_catalog, public, private`, `revoke all on function … from public, anon` then `grant execute … to authenticated`, refusals as stable messages with
`PT404`/`PT429`/`42501`/`22023`, helpers in the closed `private` schema, a rate-limit table in `private`, each migration's header says what it does and what it leaves out.

**D1 · `feat(db): buddy reads: rooms, members and Sections`** — libellus, `feat/buddy-read-db`, migration `20261113010000_buddy_reads.sql`, pgTAP `supabase/tests/buddy_reads_test.sql`.
- *Scope:* tables `buddy_reads`, `buddy_read_members`, `buddy_read_sections`, `private.buddy_calls` (part 4.1); helpers `private.buddy_member(read, member)`, `private.buddy_active_count`, `private.buddy_co_members(a, b)`;
  RPCs `create_buddy_read`, `my_buddy_reads`, `buddy_read`, `invite_to_buddy_read`, `buddy_read_link`, `buddy_read_target`, `join_buddy_read`, `answer_buddy_invite`, `leave_buddy_read`, `remove_from_buddy_read`,
  `finish_buddy_read`, `archive_buddy_read`, `set_buddy_sections`, `link_buddy_entry`, `set_buddy_hand` (part 4.3); the member-deleted/host-handover trigger; `private.can_see_photo` extended to "shares an active buddy read, no block" (and the storage-side helper `can_see_member_folder` that
  reads it, `supabase/schema-snapshot/functions/public.can_see_member_file(text).sql`); the regenerated `supabase/schema-snapshot/`; `CONTEXT.md` terms (Buddy read, Host, Section, Position).
  The `position` columns exist (`auto_through`, `hand_through`, generated `read_through`) but nothing writes `auto_through` yet (D2); `set_buddy_hand` works.
- *Not in it:* messages, reactions, reports (D3), the Realtime policy and triggers (D4), the progress → Section function (D2), any web code, any copy.
- *Tests:* **pgTAP**, acting as real signed-in members (`tests.member(...)` as `social_follows_test.sql` does), listed per RPC in part 4.5: create (shape, Catalogue Book only, Library entry required, idempotent on `client_id`, Sections validated: ordered, contiguous, 1–100 parts + one end, last `to_fraction` = 1),
  limit of one active read per host and Book, invites only people she follows and not blocked either way, cap 12 counting pending invites, link renew/off, `buddy_read_target` null for bad/blocked/ended/full tokens (the same answer for each), join by link (idempotent; blocked with **any** member → the same `not_found`; cap),
  answer invite, leave (host handover to the earliest joiner; last member leaves → the read is deleted), remove, finish/archive (host only), RLS denial for strangers/anon (no direct table select), `revoke` checked for `anon`, account deletion cascades and hands the host role on, photo visibility for co-members and not after leaving, rate limits (`rate_limited` PT429), and a **regression guard that the follower-facing functions
  (`member_card`, `member_profile`, the feed, `both_read`) still return no progress** (they do not touch the new tables). No Vitest, no flows, no Deno.
- *Docs:* `docs/parity.md` is not touched (no screen); `CONTEXT.md`; the migration header. *Tier:* **Opus** (`high`), the first of the two Opus PRs. *Size:* L.
- *Depends on:* nothing. *Risks:* locking (two joins at once vs the cap; a block vs a join; host leaving while an invite is answered): each has an advisory-lock order stated in the header and a test with `pg_advisory_xact_lock` contention only where pgTAP can show it; `can_see_photo` is read by the avatar storage policy: its change is a security change and gets its own tests.
- *Acceptance:* `supabase test db` green with the new file; `pnpm schema:snapshot` committed and CI's snapshot check green; a member calls every RPC through PostgREST from `psql`/the Vitest stack and gets the documented shapes; no table is readable by `authenticated` (`select` on each fails).

**D2 · `feat(db): a member's Section from her reading progress`** — libellus, `feat/buddy-read-position`, migration `20261113020000_buddy_read_position.sql`, pgTAP `buddy_read_position_test.sql`. On D1.
- *Scope:* `private.buddy_fraction(entry, joined_at)`, `private.buddy_refresh(read, member)` (part 5), triggers `after insert or update of progress_page, progress_percent, outcome, ended_on` on `public.reading_sessions` and `after update of book_id, page_count_override` on `public.library_entries` that refresh the memberships linked to that entry
  (one indexed lookup on `buddy_read_members(entry_id)` when there is none), a `before update of entry_id` rule that freezes `hand_through = read_through` when the link is lost (entry removed from the Library), `buddy_read()` returns each co-member's `where` (part 5.5); `link_buddy_entry` calls the refresh;
  `set_buddy_sections` (replace while no Section thread has a message) recomputes everyone.
- *Not in it:* realtime events for a changed Section (D4), the messages, the web.
- *Tests:* pgTAP: **every row of the edge-case table in part 5.3** (page, percent, finished, abandoned, no session, open re-read after a finish, edition change with a different page count, `page_count_override`, no page count, entry removed, hand above and below auto, tolerance at the boundary, host edits Sections), the refresh does nothing and writes nothing when no membership is linked (a progress update by a member in no room changes no row), and what a co-member can and cannot read from `buddy_read()` (never `progress_*`, `fraction`, dates, outcome, `entry_id`, `hand`, source).
- *Docs:* the migration header states the exception to social v1's promise in one paragraph (the applied `20261017040000_social_readers.sql` comment is not edited). *Tier:* normal at `high` (Sonnet), Opus only if the edge cases need it. *Size:* M. *Depends on:* D1.
- *Risk:* a trigger on `reading_sessions`, a hot table (the reader writes progress at most once a minute): the extra cost is one index probe; verified by `EXPLAIN` in the PR description. *Acceptance:* the pgTAP file green; `update_progress` of a member in no room is unchanged (the existing `progress_test`, `clear_progress_test` stay green).

**D3 · `feat(db): buddy read messages, reactions, delete and reports`** — libellus, `feat/buddy-read-messages`, migration `20261113030000_buddy_read_messages.sql`, pgTAP `buddy_messages_test.sql`. On D1; **Opus**, after D1.
- *Scope:* tables `buddy_messages`, `buddy_reactions`, `buddy_section_cursors`; RPCs `post_buddy_message`, `buddy_read_messages`, `react_to_buddy_message`, `delete_buddy_message`, `mark_buddy_read`, `report_buddy_message` (part 4.3); `feedback.kind` gains `report` (drop and re-add `feedback_kind`, a new migration step, never an edit of `20261024010000_feedback.sql`);
  the rate limits; the tombstone; the block filter in the reader; `my_buddy_reads()` gains unread counts (after the cursors, only over what she may open). Messages carry `kind` text | gif, `media_url` (KLIPY hosts only, the constraint is written now so K1 needs no migration) and `spoiler`.
- *Not in it:* photos (`kind = 'image'` is refused by the check until X3), the Realtime triggers (D4), push, any web code, the owner inbox's label for the new kind (W4).
- *Tests:* pgTAP, the Trappist checklist of part 4.5 per RPC: idempotent replay (same `client_id` returns the same row, no second insert), `message_client_id_reused`, order (two messages in one transaction get distinct, increasing `created_at`; a message never sorts before one written earlier), rate 30 a minute and 600 a day, member gate and the **removal race** (a message that passed the gate while the host removes her is refused), thread gate (a Section of another read refused), replies stay in their thread, tombstone clears body and gif and the reactions, host deletes any, member only her own, reactions one per member (`upsert`, the same again removes), refused across a block and on a tombstone, reader excludes both directions of a block, `report_buddy_message` writes one `feedback` row with the context and is bounded by the feedback limiter (5/h, 20/day), cursors only move forward, `anon` refused, direct table access refused, account deletion deletes her messages (cascade) and reactions.
- *Docs:* migration header; `docs/THIRD-PARTY.md` is K1's. *Tier:* **Opus**. *Size:* L. *Depends on:* D1 (and the Opus slot).
- *Risk:* the largest SQL here, ported from `trappist:supabase/schema-snapshot/functions/public.post_message(…).sql` (100 lines) and its tests; the temptation to copy Trappist's table-policy reads and direct reaction writes must be resisted (Libellus has no table grants). *Acceptance:* pgTAP green; every Trappist behaviour in part 4.5 has a named assertion; the snapshot is committed.

**D4 · `feat(db): buddy read live updates over private per-member topics`** — libellus, `feat/buddy-read-realtime`, migration `20261113040000_buddy_read_realtime.sql`, pgTAP `buddy_realtime_test.sql`. On D2 and D3.
- *Scope:* `private.member_topic(uuid)`, the policy `buddy_member_topic_select` on `realtime.messages` (`extension = 'broadcast' and realtime.topic() = private.member_topic(auth.uid())`), **no insert policy**, triggers that call `realtime.send(payload, event, topic, true)`: `message.new`, `message.deleted`, `message.reaction`, `buddy_read.changed` (Sections, status, a member joined, left, or a member's Section changed: **no numbers in it, only the read's id**), `buddy.invitation`; fan-out to active members without a block with the author; payloads in part 4.4.
- *Not in it:* the client (W2), the dashboard setting (O3).
- *Tests:* pgTAP (`realtime_test.sql` in Trappist is the model, 377 lines): a member can `select` only her own topic's rows from `realtime.messages`, not another member's; no one can insert; a message reaches each active member except a blocked author's pair and not a stranger; payloads never contain `progress_*`, `read_through`, fractions or entry ids; a Section change sends the id only. Note: **the schema snapshot does not cover `realtime.messages` policies** (`supabase/schema-snapshot/README.md`, "Left out on purpose"), so the pgTAP file is the only guard.
- *Docs:* the migration header and `docs/OPERATIONS.md` (a short "Realtime" paragraph: the topic shape, the dashboard setting, what to watch). *Tier:* normal at `high`. *Size:* M. *Depends on:* D2, D3.
- *Risk:* policy syntax on `realtime.messages` is unfamiliar here (the repo has none yet: `grep -rn "realtime.messages" supabase/migrations` is empty); Trappist's `20261110140000_realtime_member_channels.sql` is the model; hosted behaviour differs from the local stack in one setting (O3). *Acceptance:* pgTAP green; on the local stack a second client subscribed to `member:<id>` (private channel) receives a `message.new` after `post_buddy_message` (shown in W2's Vitest, which needs the real client through `#realtime-client`).

### Track W: the web app

**W1 · `feat(web): the Buddy reads switch in Profile → Account`** — libellus, `feat/buddy-reads-switch`.
- *Scope:* `web/app/utils/buddyReadsSwitch.ts` (read/write `libellus.buddyReads` in `localStorage`; **nothing stored = off** in the first release, a constant flips the default later), `web/app/stores/buddyReadsSwitch.ts`
  (the twin of `stores/friendsTab.ts`: `enabled`, `set`, `reload`, plus `canTurnOff` fed later by W2), a switch row in `web/app/components/profile/Account.vue` (EN/DE keys `profile.account.buddyReads`, `profile.buddyReads`; hint: "Read one Book with friends. Its other members see which Section you are in, never your page." — final words in P1's list), `docs/parity.md` entry beside the Friends tab's,
  `web/e2e` untouched. Forget the setting on sign-out as the Friends tab does (`stores/session.ts`).
- *Not in it:* any entry point, route or RPC call; it gates nothing yet.
- *Tests:* Vitest (`tests/buddy-reads-switch.test.ts`, the style of the Friends tab's tests: default off, writes and reads back, a corrupt value reads as off, sign-out forgets it). No flows (not a critical path), no pgTAP.
- *Docs:* `docs/parity.md`. *Tier:* normal. *Size:* S. *Depends on:* nothing. *Acceptance:* the row appears in Account in both languages, toggles at once, survives a reload, and is off after sign-out; no layout shift at 360 px (`docs/DESIGN.md`).

**W2 · `feat(web): buddy reads, the data layer, the store and the live channel`** — libellus, `feat/buddy-reads-data`. Depends on D1–D4 and S6.
- *Scope:* `web/app/data/buddyReads.ts` (framework-free repository: one function per RPC of part 4.3, taking the Supabase client; maps rows to the layer's `ChatRecord`, `BuddyReadData`, `BuddyChapter`; Libellus' error codes → keys), `web/app/data/buddyLive.ts`
  (`liveChannel` from `@fabkho/chat` with `loadRealtime: () => import('#realtime-client')` and the event parser for `message.new`, `message.deleted`, `message.reaction`, `buddy_read.changed`, `buddy.invitation`; started only while a buddy read screen or the Home card needs it),
  `web/app/stores/buddyRead.ts` (a small Pinia store on the layer's `createSaveQueue`, `thread` and `veil` modules: threads keyed by `threadKey(read, section)`, optimistic send by `clientId`, unread, her Section, the peeks in `localStorage` per member), `web/app/utils/` for the glue,
  EN keys for the error codes, `web/tests/support` helpers.
- *Not in it:* any screen (W3–W5), GIFs (K1), photos.
- *Tests:* **Vitest against the local stack** (`tests/buddy-reads.test.ts`, the repository through real RPCs with `tests/support/stack.ts` fixtures and the run tag; `tests/buddy-live.test.ts`: the real client through `#realtime-client` on the stack receives `message.new`, `message.reaction`, `buddy_read.changed`;
  the stub is not used there); unit tests for the store (send, receive, merge by `clientId`, veil, unread, offline queue and retry, refusals handed back). A Vitest check that **`stores/buddyRead.ts` and `data/buddyLive.ts` are not imported from the entry** (the entry-chunk guard of S6 is the build-time proof).
- *Docs:* `web/AGENTS.md` one line (the buddy-read store and the lazy door); `docs/parity.md` not yet. *Tier:* normal. *Size:* L. *Depends on:* D1–D4, S6.
- *Risk:* the Free plan's 200 concurrent Realtime connections and the lazy door; mitigation: one channel per device, started on demand, stopped when the screens close (the Home card reads `my_buddy_reads()` on focus instead). *Acceptance:* the Vitest suites green on the stack; the entry chunk unchanged within 1 KB; opening any page that does not use buddy reads makes no Realtime request.

**W3 · `feat(web): start a buddy read, invite friends, join by link`** — libellus, `feat/buddy-reads-setup`. Depends on W2, W1.
- *Scope:* the setup sheet (`web/app/components/together/SetupSheet.vue`: Book → Sections → Invite, `UiSheet`, `UiSegmented`, `UiCheckList` for friends, the layer's `chapters.ts` arithmetic for count/pages with grouping above 30, `UiThreadRow` previews), the invite sheet, the link page `web/app/pages/t/[token].vue` (the twin of `pages/f/[token].vue`: `buddy_read_target`, Join / Not now, "Which copy are you reading?"),
  `web/app/utils/pendingBuddyRead.ts` and the `auth.global.ts` hook (the twin of `utils/pendingFollow.ts`: the token survives sign-in), an invitation row in Friends and the lamp dot, members sheet (Remove for the host, Leave), the hint copy, EN + DE, `docs/parity.md` entries, a11y (APG patterns, 44 px, 360 px, focus return), `publicPath` unchanged (the link needs sign-in).
  Opening a link or accepting an invite while the switch is off asks once "Turn on Buddy reads?" and turns it on (the join is a deliberate act).
- *Not in it:* the room and threads (W4), entry points on the Book page and Home (W5), GIFs.
- *Tests:* Vitest (pure: pending token keep/peek/expire, section arithmetic through the layer, setup validation); **no new flow here** (W4 holds the one flow); component-level checks where the repo already has them (`tests/ui-layer*` style guards only). The link page's refusals are covered by pgTAP in D1.
- *Docs:* `docs/parity.md` (setup, invite, link page, members), `docs/DESIGN.md` only if a token is new. *Tier:* normal. *Size:* L. *Depends on:* W2, W1.
- *Acceptance:* on a phone viewport against the local stack: a host starts a read for a Library Book with 5 count-based Sections, invites a followed member, copies the link; a second member opens the link signed out, signs in, lands on the join card, joins and picks her entry; the host sees her in the members sheet; a blocked member's link answers "This link doesn't work anymore".

**W4 · `feat(web): the room, a Section's thread, reactions, delete, report, finish`** — libellus, `feat/buddy-reads-room`. Depends on W2, D3.
- *Scope:* `web/app/pages/together/[id]/index.vue` (hero, the track of members by Section, the Sections as `UiThreadRow`s with veiled rows, ⋯ menu), `pages/together/[id]/[section].vue` (the thread: `UiChatThread` + `UiBubble` + `UiComposer` + `UiReactionBar` with Copy, Delete, Report in `actions`, day separators from the base, `banner` slot for the "reading ahead" note, `role="log"`), the marker sheet "Where are you?" (hand override and "automatic"), "Show anyway" confirm with the peek,
  finish and archive (host), the finish flow's "The whole book" thread, the room thread, `FEEDBACK_KINDS` gains `report` and `contact.kind.report` EN/DE (`web/app/data/feedback.ts:22`, `pages/profile/feedback.vue:100`), CONTEXT-term copy, EN + DE, `docs/parity.md`, a11y, `prefers-reduced-motion`.
- *Not in it:* GIFs, photos, push, the Home card.
- *Tests:* Vitest (store paths already in W2; new: the veil in the thread view model, the report payload); **one Playwright flow** `e2e/buddy-read.spec.ts`, tagged `@full`: two browsers — the host starts a read, the member joins by link, the host posts in the room, it arrives live for the member; the member's veiled Section stays veiled until "Show anyway". Runs under `full-e2e`; **add that label to this PR before merging** so it runs early, and in the release run. a11y scan in the flow's dark theme only (`docs/TESTING.md`).
- *Docs:* `docs/parity.md` (room, thread, marker sheet, owner inbox kind). *Tier:* normal. *Size:* L. *Depends on:* W2, D3 (and W3 for the flow's setup, which uses the RPCs directly if W3 is not merged).
- *Acceptance:* the flow green under `full-e2e`; a thread at 200 % text reflows (no cut-off), VoiceOver names for a veiled row ("Section 9, hidden, 12 comments"); a tombstoned message reads "Message removed".

**W5 · `feat(web): the Book page row and the Home card`** — libellus, `feat/buddy-reads-entries`. Depends on W3.
- *Scope:* a *Read together* row under the Book page's actions (`web/app/pages/book/[key].vue`, only for a Catalogue Book in her Library, only with the switch on), the Home card "Reading together" with unread counts (`web/app/components/home/`, from `my_buddy_reads()` on focus, no Realtime), the Home Currently-reading card's ⋯ action, the invitation card; all hidden with the switch off.
- *Tests:* Vitest for the view models; no flow. *Docs:* `docs/parity.md` (Book page, Home). *Tier:* normal. *Size:* S. *Depends on:* W3. *Acceptance:* switch off → neither entry exists and nothing calls the buddy RPCs; switch on → both appear in the right place.

### P1, K1, X: the promise, GIFs, later

**P1 · `docs(legal): her Section is the one thing about her reading that a buddy read shows`** — libellus, `docs/progress-promise`. **Start now; merge with release 1.** The exact list, with file:line and EN/DE replacements, is part 6.
- *Scope:* only the files in part 6 (the privacy notice EN and DE with a new version date, the Privacy sheet's note in `en.json`/`de.json` + `.i18n-kit.lock.json`, SPEC.md, README.md, `docs/parity.md` line 619, the social proposals' sentences, `docs/legal-checklist.md` if it lists the notice's sections). *Not in it:* code, and `CONTEXT.md` (D1 writes the new terms). A word that appears in the notice but no feature yet = the notice is merged when the release carries the feature, never before it ships (the release PR decides).
- *Tests:* `web/tests/legal.test.ts` (same sections in both languages, version present, no stray placeholders), the i18n parity test (`pnpm i18n:verify`), `pnpm test`'s `ui-text` unaffected. *Tier:* normal. *Size:* M. *Acceptance:* O6 (the owner reads EN and DE); no file in part 6's "change" list still says progress never leaves.

**K1 · `feat(web): GIFs from KLIPY in buddy reads`** — after release 1 and O4. Scope: `web/app/data/buddyGif.ts` wiring the layer's KLIPY client (key from `runtimeConfig.public.klipyKey` / `NUXT_PUBLIC_KLIPY_KEY`, locale from the app language, English topic chips "BookTok / Reading / Books / Trending" in `en.json`/`de.json`), `UiGifPicker` in the composer with the base's `attribution` slot "Powered by KLIPY",
the CSP in `web/public/_headers` (`connect-src https://api.klipy.com`, `img-src https://static*.klipy.com`; today a Report-Only policy), `docs/THIRD-PARTY.md` (a KLIPY row: what it gets: the search words, the device's IP and an opaque id, nothing else; the layer's `customerIdFor`), `web/app/legal/privacy.ts` (EN/DE, new version date), `docs/OPERATIONS.md` (the key). Tests: Vitest with recorded KLIPY answers (moved with the client), the DB already accepts the URL (D3). Tier normal, M.

**X1 · push for replies** (own spec later): a general events table and sender for kinds, reusing `push_subscriptions` (`20261106010000`), `supabase/functions/import-job/push.ts`'s sender (or the shared one if the owner wants the two senders merged) and `web/public/sw-push.js`; a "someone answered you" kind; preferences. Needs Deno tests (`deno task test` in the function's folder, run by `ci.yml`), pgTAP, an owner decision on preferences, privacy text. **X2 · the ebook chapters and the saved list**: `from: 'list'` Sections from the reader's TOC (`web/app/reader/engine.ts` `TocItem`, line 32; labels and fractions only, never the file) and `book_chapters` crowd-saved lists by Catalogue Book; Vitest with the probe fixtures of the old plan (`plan/buddy-read:docs/plans/img/buddy-read-api-probes/`). **X3 · photos**: only after a Supabase Pro decision (egress); a private bucket `buddy-media` with path policies, `send` RPC variant, `chat-media-sweep`-style cleanup edge function (Deno tests), the layer's `photo.ts`, a monthly cap, privacy text.

## 4. The Libellus data model

Source of truth for shapes: the migrations D1–D4 once written; this part is what a worker starts from. Everything follows `AGENTS.md` "The database"
and `web/AGENTS.md`: RLS on every table with no policy for members, `revoke all … from anon, authenticated`, **all reads and writes through
`security definer` RPCs**, helpers in `private`, refusals as stable messages (the client maps by message, `web/app/data/socialShapes.ts`; HTTP via `PT404` / `PT429`,
`20261019020000_social_http_codes.sql`), one RPC for every multi-row change, rate limits in a `private.*_calls` table (like `private.follow_calls`) or counted in the function.
It mirrors Trappist's shape (a room with members and messages that carry a thread id) so the port of its behaviour is mechanical, and differs where Libellus' rules differ:
no direct table reads (Trappist's 1:1 half uses a select policy and writes reactions into the table; Libellus does neither), `auth.users` as the identity, `private.blocked_either` as the block test.

### 4.1 Tables (all `public`, RLS enabled, `revoke all … from anon, authenticated`)

```sql
-- D1 ------------------------------------------------------------------
create table public.buddy_reads (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.books (id) on delete restrict,   -- the edition the Sections were cut from; a Catalogue Book (books.source <> 'manual')
  host_id       uuid references auth.users (id) on delete set null,              -- handed over by trigger when the host leaves or her account goes
  status        text not null default 'active' check (status in ('active','finished','archived')),
  starts_on     date not null default current_date,
  link_token    text unique check (link_token ~ '^[A-Za-z0-9_-]{22}$'),         -- null = link off; private.reading_page_token(), 128 bits
  sections_from text not null default 'count' check (sections_from in ('count','pages','list')),
  page_count    integer check (page_count between 1 and 99999),                  -- the pages the fractions were cut from; null = by count/percent
  client_id     uuid not null,
  created_at    timestamptz not null default clock_timestamp(),
  finished_at   timestamptz,
  archived_at   timestamptz,
  unique (host_id, client_id)                                                    -- an idempotent create
);
create unique index buddy_reads_one_active on public.buddy_reads (host_id, book_id) where status = 'active';
create index buddy_reads_book on public.buddy_reads (book_id);

create table public.buddy_read_members (
  buddy_read_id uuid not null references public.buddy_reads (id) on delete cascade,
  member_id     uuid not null references auth.users (id) on delete cascade,
  role          text not null default 'member' check (role in ('host','member')),
  invited_by    uuid references auth.users (id) on delete set null,
  invited_at    timestamptz not null default now(),
  joined_at     timestamptz,                                                     -- null = invited, not answered; only joined members count, read and write
  entry_id      uuid references public.library_entries (id) on delete set null,  -- her copy; what makes the Section automatic
  auto_through  smallint check (auto_through >= 0),                              -- Sections completed, from her progress (D2); null = unknown
  hand_through  smallint check (hand_through >= 0),                              -- Sections she says she completed; null = not set
  read_through  smallint generated always as (greatest(coalesce(auto_through, 0), coalesce(hand_through, 0))) stored,
  last_read_at  timestamptz,                                                     -- the room's unread cursor
  primary key (buddy_read_id, member_id)
);
create index buddy_read_members_member on public.buddy_read_members (member_id);
create index buddy_read_members_entry on public.buddy_read_members (entry_id) where entry_id is not null;

create table public.buddy_read_sections (
  id            uuid primary key default gen_random_uuid(),
  buddy_read_id uuid not null references public.buddy_reads (id) on delete cascade,
  position      smallint not null check (position between 1 and 101),
  kind          text not null default 'part' check (kind in ('part','end')),     -- 'end' = "The whole book", always last, opens when every part is read
  label         text not null check (char_length(label) between 1 and 120),
  start_page    integer, end_page integer,                                       -- in the read's edition, optional, for the label
  to_fraction   numeric(5,4) not null check (to_fraction > 0 and to_fraction <= 1),  -- where the Section ends, as a fraction of the book
  unique (buddy_read_id, position) deferrable initially deferred,
  check ((start_page is null) = (end_page is null) and (start_page is null or end_page >= start_page)),
  check (kind = 'part' or to_fraction = 1)
);
create unique index buddy_read_sections_one_end on public.buddy_read_sections (buddy_read_id) where kind = 'end';

create table private.buddy_calls (                                               -- rate limits: 'create' and 'invite' 20 an hour, 'join' 30 an hour
  member_id uuid not null references auth.users (id) on delete cascade,
  kind      text not null,
  at        timestamptz not null default now()
);
create index buddy_calls_member_at on private.buddy_calls (member_id, kind, at);

-- D3 ------------------------------------------------------------------
create table public.buddy_messages (
  id            uuid primary key default gen_random_uuid(),
  buddy_read_id uuid not null references public.buddy_reads (id) on delete cascade,
  section_id    uuid references public.buddy_read_sections (id) on delete cascade,   -- null = the room ("Before we start")
  author_id     uuid not null references auth.users (id) on delete cascade,          -- her account goes: her messages go (privacy text, part 6)
  client_id     uuid not null,
  kind          text not null default 'text' check (kind in ('text','gif')),          -- 'image' arrives with X3
  body          text not null default '' check (char_length(body) <= 2000),
  media_url     text, media_width integer, media_height integer,                      -- a GIF: https://static*.klipy.com/… only, checked
  reply_to      uuid references public.buddy_messages (id) on delete set null,
  spoiler       boolean not null default false,                                       -- only in a Section thread
  created_at    timestamptz not null default clock_timestamp(),                       -- never now(): clock order, set again in post_buddy_message
  deleted_at    timestamptz,
  deleted_by    uuid references auth.users (id) on delete set null,
  unique (author_id, client_id)
  -- checks: text → 1..2000 chars unless deleted; gif → media_url matches the KLIPY pattern, 1..10000 px; deleted → body = '' and media null; spoiler → section_id is not null
);
create index buddy_messages_read on public.buddy_messages (buddy_read_id, created_at desc, id desc);
create index buddy_messages_section on public.buddy_messages (section_id, created_at desc) where section_id is not null;
create index buddy_messages_author on public.buddy_messages (author_id, created_at desc);   -- the rate limit, account deletion

create table public.buddy_reactions (                                             -- one per member and message (the base's bar lights one emoji)
  message_id uuid not null references public.buddy_messages (id) on delete cascade,
  member_id  uuid not null references auth.users (id) on delete cascade,
  emoji      text not null check (emoji in ('❤️','😂','😮','😢','🔥','📚')),
  created_at timestamptz not null default now(),
  primary key (message_id, member_id)
);
create index buddy_reactions_member on public.buddy_reactions (member_id);

create table public.buddy_section_cursors (                                       -- unread per Section; the room's cursor is buddy_read_members.last_read_at
  section_id   uuid not null references public.buddy_read_sections (id) on delete cascade,
  member_id    uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (section_id, member_id)
);
```

Foreign keys carry the account deletion for free: `delete_my_account()` (`supabase/schema-snapshot/functions/public.delete_my_account().sql`) deletes `library_entries` then
`auth.users`, and the cascades take her memberships, messages, reactions and cursors. The one trigger needed is `private.buddy_member_gone()`, `after delete on buddy_read_members`: if the host row went, the earliest-joined
remaining member becomes host (`role`, `buddy_reads.host_id`); if nobody is left, the read is deleted (cascading its messages). No storage objects exist in v1 (no photos), so there is no cleanup job.
Indexes cover every new foreign key (the repo's advisor pass, `docs/OPERATIONS.md` "Supabase advisors").

### 4.2 Who can do what

- No policies, no grants to `anon`/`authenticated`: a member cannot `select` any of these tables; every read is an RPC that first proves she is a **joined** member (`private.buddy_member(read, uid)`).
- A block between two members of a read never removes either: they stop seeing each other's messages and reactions (Trappist D6, owner Q19); nobody can be invited across a block; the link answers "no longer valid" to anyone blocked with any member.
- `private.can_see_photo(caller, owner)` gains `or private.buddy_co_members(caller, owner)` (both joined in one read, no block): co-members can see each other's avatar without a follow (the old plan's privacy line "co-members seeing her name and photo even without a follow"). `private.member_name` is already visible to any member. Test it, and test that leaving ends it.
- Hosts: invite, link, remove members, rename/replace Sections while empty, finish/archive, delete any message. Members: leave, post, react, delete their own, report, hand override. The host sees no more of a member's position than anyone (part 5.5).

### 4.3 The RPCs (public, `security definer`, `set search_path = pg_catalog, public, private`, `grant execute … to authenticated` only)

All answer `not_signed_in` (42501) without a session and refuse as a stranger (`not_found`, PT404) when she is not a joined member, so a read's existence is never revealed.

| RPC | Does | Refusals, limits |
|---|---|---|
| `create_buddy_read(p_book uuid, p_client_id uuid, p_sections jsonb, p_invite uuid[] default '{}', p_link boolean default false, p_starts date default null) returns jsonb` | host creates a read of a Catalogue Book she holds in her Library; her member row links that entry; Sections validated (ordered, contiguous, 1–100 `part` + exactly one `end`, last `part.to_fraction` ≤ 1, labels 1–120); optional invites and link; idempotent on `(host, client_id)`; returns `{id, link_token}` | `buddy_book_invalid` (Manual book or not in Library), `buddy_sections_invalid`, `buddy_read_exists` (an active read of hers for this Book: returns the id in `details`), `rate_limited` 20/h, `buddy_read_limit` (10 active reads per member) |
| `my_buddy_reads() returns jsonb` | her reads and waiting invites: book card, status, role, member count, her own Section, unread (after cursors, only over Sections she may open) | one query per focus |
| `buddy_read(p_id uuid) returns jsonb` | the screen: book, status, role, `can_manage`, Sections `[{id, position, kind, label, start_page, end_page, count, unread}]`, members `[{member card, role, where}]` (part 5.5), her own `read_through`, `hand`, `auto`, link (host only) | |
| `invite_to_buddy_read(p_id uuid, p_members uuid[]) returns jsonb` | host invites people she **follows** (accepted) and who are not blocked either way; the cap of 12 counts pending invites | `not_host` (PT403), `buddy_read_full`, `not_found` per ineligible person (silently skipped, listed as `skipped`), `rate_limited` |
| `buddy_read_link(p_id uuid, p_on boolean, p_renew boolean default false) returns text` | host: switch the link on/off, renew (the old dies) | `not_host` |
| `buddy_read_target(p_token text) returns jsonb` | the join card: book, host, member faces, Section count, start day; **null** for a bad, off, renewed, ended, full or blocked token (one answer for all, never revealing a block) | |
| `join_buddy_read(p_token text) returns jsonb` | joins; idempotent; refuses (as `not_found`) when blocked with **any** member; cap 12; locks the read | `rate_limited` 30/h |
| `answer_buddy_invite(p_id uuid, p_join boolean) returns void` | accept or decline an invitation | |
| `link_buddy_entry(p_id uuid, p_entry uuid) returns jsonb` | links her Library entry (same Book, or the same non-null `openlibrary_work_key` and not `check_failed`, as `book_readers` decides, `supabase/schema-snapshot/functions/public.book_readers(uuid,jsonb,integer).sql:64`); `p_entry null` unlinks; refreshes her Section | `buddy_entry_invalid` |
| `set_buddy_hand(p_id uuid, p_through smallint) returns jsonb` | the hand override: `null` clears it; 0…N parts (N = the "I've read it" value) | `buddy_position_invalid` |
| `leave_buddy_read(p_id uuid, p_delete_messages boolean default false) returns void` | deletes her member row and cursors (her Section stops being shown at once); optionally deletes her messages; host handover by trigger | |
| `remove_from_buddy_read(p_id uuid, p_member uuid) returns void` | host removes a member | `not_host` |
| `finish_buddy_read(p_id)`, `archive_buddy_read(p_id)`, `set_buddy_sections(p_id, p_sections jsonb)` | host; `finish` keeps threads writable, `archive` is read-only; `set_buddy_sections` renames always and replaces the division only while no Section thread has a message (D3 adds the message check), then recomputes everyone | `not_host`, `buddy_sections_locked` |
| `post_buddy_message(p_read uuid, p_section uuid, p_client_id uuid, p_kind text, p_body text, p_reply_to uuid default null, p_spoiler boolean default false, p_gif jsonb default null) returns jsonb` (D3) | `p_section null` = the room | `message_client_id_required`, `message_client_id_reused`, `message_conversation_unavailable`→`buddy_read_unavailable`, `buddy_read_archived`, `message_reply_unavailable`, `message_rate_limited` (30 a minute, 600 a day), `message_spoiler_unavailable`, `message_gif_invalid` |
| `buddy_read_messages(p_read uuid, p_section uuid default null, p_before timestamptz default null, p_after timestamptz default null, p_limit integer default 50) returns jsonb` (D3) | pages of ≤ 100, newest first; tombstones without body; reactions aggregated `{emoji, count, mine}`; both directions of a block left out | |
| `react_to_buddy_message(p_message uuid, p_emoji text) returns void`, `delete_buddy_message(p_message uuid)`, `mark_buddy_read(p_read uuid, p_section uuid, p_through timestamptz)`, `report_buddy_message(p_message uuid, p_reason text, p_note text default null)` (D3) | react (`null` removes; one per member), tombstone (author or host), cursors (forward only), report → one `feedback` row `kind = 'report'`, `context = {buddy_read, section, message, author, excerpt ≤ 300}` | reactions 60 a minute; report limited by the feedback limiter (5/h, 20/day, `private.feedback_rate_limit()`), reasons `harassment`, `spam`, `inappropriate`, `other` |

Where the old plan and Trappist differ on a name or a shape, this table wins; a worker may adjust a signature for a good reason and says so in the PR.

### 4.4 Realtime: private topic per member, a policy, no insert (D4)

```sql
create function private.member_topic(p_member uuid) returns text language sql immutable
  set search_path = pg_catalog as $$ select 'member:' || p_member::text $$;

create policy buddy_member_topic_select on realtime.messages for select to authenticated
  using (extension = 'broadcast' and (select realtime.topic()) = private.member_topic((select auth.uid())));
-- no insert policy: nobody broadcasts but the triggers (security definer, realtime.send(..., private => true)).
```
(Modelled on `trappist:supabase/migrations/20261110140000_realtime_member_channels.sql`.) Events, each sent to every joined member except pairs blocked with the author:

| Event | Payload | Never in it |
|---|---|---|
| `message.new` | the message row without `deleted_*`: `id, buddy_read_id, section_id, author_id, client_id, kind, body, media_url, media_width, media_height, reply_to, spoiler, created_at` | — (the veil is the client's, Q8) |
| `message.deleted` | `{id, buddy_read_id, section_id}` | the body |
| `message.reaction` | `{message_id, buddy_read_id, member_id, emoji \| null}` | — |
| `buddy_read.changed` | `{buddy_read_id}`: Sections, status, a member joined, left, removed or **changed Section** | **any number**: no `read_through`, no fraction, no page |
| `buddy.invitation` | `{buddy_read_id}` to the invitee only | — |

The client resyncs from the RPCs after a rejoin and after the cold start (the layer's `liveChannel`, S2), so a missed broadcast costs nothing. Free plan: a post to 11 others is 12 messages (part 9).

### 4.5 The Trappist behaviour checklist as a pgTAP list

Each line is one named assertion in the file named (the "bugs it paid for", from `trappist:supabase/schema-snapshot/functions/` and its tests; part 1.2 of the appendix has the sources).

**`buddy_messages_test.sql` (D3), per RPC**
- *post_buddy_message*: (1) same `client_id` twice returns the first row and inserts none; (2) the same `client_id` for another read/Section/kind raises `message_client_id_reused`; (3) `p_client_id null` refused; (4) two posts inside one transaction have increasing, distinct `created_at`, and a post never sorts before an earlier one (`greatest(clock_timestamp(), max(created_at) + 1 µs)` per read, under the read's lock); (5) 30 in a minute allowed, the 31st `message_rate_limited`; 600 a day; (6) **the removal race**: a poster who passed the member check while the host's removal holds the read's lock is refused after the lock, not written (`pg_advisory_xact_lock` order sender → read, tested with two sessions where pgTAP can, else by the documented order and a single-session simulation); (7) a Section of another read refused; (8) a reply must be in the same thread and not a tombstone (`message_reply_unavailable`); (9) archived read refuses, finished accepts; (10) a GIF URL off the KLIPY hosts refused by the constraint; (11) `spoiler` only with a Section; (12) a left or removed member refused.
- *buddy_read_messages*: (13) pages by `before`/`after`, ≤ 100; (14) both directions of a block hidden, her own always shown; (15) tombstones carry no body or URL; (16) a stranger gets `not_found`; (17) a left member gets nothing.
- *react_to_buddy_message*: (18) one per member (a second emoji replaces, the same again removes); (19) refused on a tombstone and across a block; (20) 60 a minute; (21) not for a non-member.
- *delete_buddy_message*: (22) the author tombstones (body, URL, reactions cleared, `deleted_by` set); (23) the host any; (24) another member refused; (25) idempotent.
- *mark_buddy_read*: (26) cursors only move forward; room and Section; a Section of another read refused.
- *report_buddy_message*: (27) one `feedback` row, `kind = 'report'`, context ≤ 4000 bytes with the excerpt; (28) not her own message; (29) members only; (30) the feedback limiter applies.
- *account deletion / export*: (31) deleting the author's account deletes her messages and reactions; (32) the unique `(author_id, client_id)` survives a deleted author for others.

**`buddy_reads_test.sql` (D1) — membership, links, host**
- (33) create idempotent on `client_id`; (34) Catalogue Book only and only from her Library; (35) Sections validated; (36) one active read per host and Book; (37) cap 12 counts pending invites, also under two joins at once (the read's advisory lock); (38) invite only followed, unblocked people; (39) `buddy_read_target` returns the same `null` for a wrong token, an off link, a renewed one, an ended read, a full read and a blocked visitor; (40) `join_buddy_read`: idempotent, blocked with *any* member → `not_found`; (41) leave → host handover to the earliest joiner; the last member leaving deletes the read; (42) a member of no read has no row anywhere (no `select`); (43) co-members see each other's avatar and not after leaving; (44) account deletion hands the host over / deletes an empty read; (45) rate limits.

**`buddy_realtime_test.sql` (D4)**
- (46) she can read only her own topic's broadcast rows; (47) no insert policy; (48) fan-out to members but not to a blocked pair with the author nor to a stranger; (49) payloads carry no progress, fractions or `read_through`; (50) a Section change sends only the id; (51) a removed member stops receiving.

## 5. Section and position design

### 5.1 What a Section is

A Section has an end as a fraction of the book, `to_fraction` (the "Sections follow the edition's pages" line of the old plan, but stored as a fraction so editions, ebooks and audiobooks line up).
Divisions the setup offers in v1 (the layer's `chapters.ts`, arithmetic in the client; the server validates the list it receives):

- **By count**: N parts, `to_fraction = k / N`, labels "Section 1" … in the host's language (stored text; the client names them, the server never needs a locale). Above 30 the sheet offers grouping 2 or 3 (`GROUPING_ABOVE`).
- **By pages**: parts of P pages (default 50, `DEFAULT_PAGES_PER_PART`); `to_fraction = min(1, end_page / page_count)`; `page_count` and the page labels are kept.
- **By list** (X2): explicit labels with fractions, from her ebook's TOC or a saved list.
- Always one `end` Section, "The whole book", `to_fraction = 1`. The **room** thread ("Before we start") is not a Section: `section_id = null`.

### 5.2 Her fraction, and the session that counts

```
f(entry, joined_at) =
  session  := the entry's open session (outcome is null), else the latest closed session
              with coalesce(ended_on, started_on) >= joined_at::date, else none
  none                          -> null   (unknown: no automatic position)
  outcome = 'finished'          -> 1
  progress_page is not null     -> least(1, progress_page / coalesce(entry.page_count_override, book.page_count))   (null if there is no page count)
  progress_percent is not null  -> progress_percent / 100                                                       (the reader writes a page of the count, else a percent: web/app/data/reader/progress.ts `progressAt`)
  else                          -> 0
auto_through = count of 'part' Sections with to_fraction <= f + 0.005        (null when f is null)
read_through = greatest(coalesce(auto_through, 0), coalesce(hand_through, 0))     (the generated column)
```
`0.005` is a half-percent tolerance for the front-matter difference between editions (a page of a 300-page book is 0.0033; the old plan accepted "a few %"). A Section counts as **read when she is through it**, not when she is in it: this is Trappist's marker ("read through chapter n opens threads up to n",
`trappist:web/layers/chat/app/utils/veil.ts`), so the layer's `veil.ts` is used unchanged. The old plan opened a Section at its start and hid messages inside it by anchor; Q8 chose the veil.

### 5.3 The edge cases, each a pgTAP assertion in D2

| Case | Rule |
|---|---|
| Progress in pages, read's edition has 400 pages, hers 380 | fractions are compared, not pages: 190/380 = 0.5 completes a Section ending at 0.5 |
| Progress in percent (no page count, or the reader on an edition without pages) | `percent / 100` |
| Progress page, but no page count anywhere | `f` null: no automatic position, she is told "set it by hand" (W3/W4), the hand override works |
| Finished | `f = 1`: every part, and "The whole book" opens |
| Abandoned (DNF) | the session counts if it ended on or after joining; `f` is its last progress, frozen; others see her Section, never that she gave up |
| Finished **before** she joined (an older session) | not counted: auto is unknown. At the join the app offers "I've already read it" → `hand_through = N`. Nothing is opened silently |
| A re-read: a new open session after a finish | the open session wins, `f` is its progress (0 at the start), so **her Section falls back**; the hand override ("I've read it") is the remedy; documented in the marker sheet |
| Edition changed (`change_edition`) | the entry's Book and page count change; the refresh trigger on `library_entries(book_id, page_count_override)` recomputes with the new count |
| `page_count_override` set or cleared | same trigger |
| Her entry is removed from the Library | `entry_id` becomes null; a rule freezes `hand_through = read_through` first, so her Section stays where it was and she can change it by hand; nothing silently opens or closes |
| No linked entry, never set | `auto` null, `hand` null: her Section is **not set**; others see "not set"; she sees the room thread only |
| Hand above auto | the hand wins (`greatest`): she has read it on paper and says so |
| Hand below auto | auto wins: a hand value can only open more, never hide what her progress already opened (hiding is not the veil's job; she can use "leave") |
| She corrects her progress downwards (the Update sheet) | auto follows down; the veil follows; she keeps nothing she was not entitled to (peeks stay: a device choice) |
| Boundary | `to_fraction = 0.5000`, `f = 0.4950` completes it, `f = 0.4949` does not |
| The host replaces the division (allowed only while no Section thread has a message) | all members' `auto_through` is recomputed; `hand_through` is clamped to the new N |
| Re-reading the same Book in another room | independent: each membership links its own entry and joined date |

### 5.4 What the veil does

For the viewer's `read_through = r`: Section `position <= r` is **open**; "The whole book" is open when `r >=` the number of parts; every other Section is **veiled**: the row shows its number and comment count, never its label (a renamed label can spoil, Trappist D18),
no unread dot, no avatar-of-who-is-there beyond a count; opening it asks first ("Show anyway", then remembered on this device as a *peek*, her position does not move; `createPeeks` in the layer's `veil.ts`). A veiled Section's messages are not signed or loaded as media (v1 has GIFs only, which are the sender's choice of a public KLIPY URL: not loaded until open). The room thread is always open. A comment marked **Spoiler** is veiled for everybody until tapped.
The veil is drawn by the app, not enforced by the database (Q8): the API gives every member every message of the read. D4's events and every count outside a thread (Home card, Section rows) carry numbers and names only, never words of a message.

### 5.5 What a co-member can and cannot see

From `buddy_read(p_id)` and `my_buddy_reads()`, **only for a member who has joined that read and only while she is in it**:

- **Can:** her name and photo (a card), her role (host/member), and **`where`**: one of `section k` (1…N, "reading Section k" = `read_through + 1`), `end` (every part read, the whole book is open), `not set`. For the host and for every other member alike.
- **Cannot, ever:** her page, her percent, her fraction, the date of any progress, whether the Section came from progress or from her hand, whether she finished, gave up or re-reads, her entry id, her edition or format, her other Books, her notes, highlights, reviews, ratings, reasons.
- **Never outside the room:** `member_card`, the feed, Friends, the follower's Profile and the reading page do not read these tables (D1's regression test); a follower who is not in the room sees nothing of it, and a member who is in the room sees nothing outside it.
- **Leaving stops it at once**: `leave_buddy_read` deletes her member row, so the next `buddy_read()` of anyone no longer lists her and `private.buddy_co_members` is false; her messages stay unless she chose to delete them (and a deleted account takes them). Being **removed** by the host does the same. **Turning the Profile switch off does not** (it only hides the entry points): the switch cannot be turned off while she is in an active room without a confirm that offers "Leave my buddy reads and turn off" (W2's `canTurnOff`, W1's store), so the switch never gives a false sense that sharing stopped.

## 6. Removing the promise "progress never leaves"

The owner's decision: a member's progress is **not** an absolute secret. It stays out of every follower-facing and public surface, and it is visible **only as a Section, only to the
members of a buddy read she joined, only while she is in it**. Part 5.5 is the precise statement; this part lists every place that makes or implies the old promise, found by searching the
repository for "never", "nie", "private", "stays", "leaves" next to "progress", "Fortschritt", "reading days", and by reading the privacy notice, README, SPEC, CONTEXT, parity, the social proposals and
the copy files. **Line numbers are at `origin/main` `78e974e4`** and shift once P1 starts; each item says what to do.

### 6.1 Change these (P1 unless noted)

| # | Where | Says now | Replace with (EN / DE) |
|---|---|---|---|
| 1 | `web/i18n/locales/en.json:1999`, `de.json:1999`, key `privacy.never` (drawn by `web/app/components/friends/PrivacySheet.vue:90`; `web/.i18n-kit.lock.json` carries its hash: run `pnpm i18n:translate`, commit both files and the lock) | "Your reasons for not finishing, your progress and your notes are never shown. Hide a single Book in its options." / "Deine Gründe für Abbrüche, dein Fortschritt und deine Notizen sind nie sichtbar. Einzelne Bücher kannst du in ihren Optionen verbergen." | **EN:** "Followers never see your reasons for not finishing, your progress or your notes. Hide a single Book in its options. In a buddy read you join, its other members see which Section you are in, never a page or a percent." **DE:** "Follower sehen nie deine Gründe für Abbrüche, deinen Fortschritt oder deine Notizen. Einzelne Bücher kannst du in ihren Optionen verbergen. In einem Buddy-Read, dem du beitrittst, sehen die anderen Mitglieder, in welchem Abschnitt du bist, nie eine Seite oder Prozentzahl." |
| 2 | `docs/parity.md:619` (the Privacy sheet's entry quotes the note: `privacy.never` ("Your reasons for not finishing, your progress and your notes are never shown. Hide a single Book from its ⋯ menu.")) | the old sentence | the new EN sentence from item 1 (and fix the pre-existing "⋯ menu" vs "options" drift while there) |
| 3 | `SPEC.md:165–168`, the *Social (social v1)* bullet: "Followers see only the sections she switched on, never a hidden Book, her notes, her progress or her reasons for not finishing; …" | an absolute for followers | keep the sentence (it is true of followers) and add after it: "The one place progress is shown is a buddy read she joined: its members see which Section she is in, never a page, a percent or a date, and only while she is a member." Add a *Buddy reads* bullet to SPEC's feature list with the same limits (SPEC.md has none; the last "After v1" list at `SPEC.md:211` names page progress, not buddy reads) |
| 4 | `web/app/legal/privacy.ts:36` (EN) and `:180` (DE), the **Friends** paragraph | lists Friends data only | insert a new paragraph right after it (EN `:37`, DE `:181`, the rest shifts down). **EN:** "**Buddy reads (only if you join one).** A reading room for one Book with other members, who joined because you or they invited them or by a link. It holds your messages, your reactions, GIFs you pick, and the Section of the Book you are in. That Section is worked out from your reading progress (or set by you) and shown to the other members of that room as a Section only: never a page, a percent or a date. It stops when you leave the room or it is removed. Messages you wrote stay in the room until you delete them, you leave and ask to delete them, or you delete your account. If you report a message, it is sent to me with the report." **DE:** "**Buddy-Reads (nur wenn du einem beitrittst).** Ein Leseraum zu einem Buch mit anderen Mitgliedern, die auf deine oder ihre Einladung oder über einen Link beigetreten sind. Er enthält deine Nachrichten, deine Reaktionen, GIFs, die du auswählst, und den Abschnitt des Buchs, in dem du bist. Dieser Abschnitt wird aus deinem Lesefortschritt berechnet (oder von dir gesetzt) und den anderen Mitgliedern des Raums nur als Abschnitt gezeigt: nie eine Seite, eine Prozentzahl oder ein Datum. Er endet, wenn du den Raum verlässt oder er gelöscht wird. Nachrichten von dir bleiben im Raum, bis du sie löschst, den Raum verlässt und das Löschen verlangst oder dein Konto löschst. Meldest du eine Nachricht, wird sie mit der Meldung an mich geschickt." |
| 5 | `privacy.ts:35` / `:179`, **Your reading data** ("…your progress…") | stored data, true | append to the sentence: "…your progress (only as the Section you are in does it reach the members of a buddy read you joined)." / "…dein Lesefortschritt (nur als Abschnitt, in dem du bist, erreicht er die Mitglieder eines Buddy-Reads, dem du beitrittst)…" |
| 6 | `privacy.ts:55` / `:199`, the legal basis (Art. 6(1)(b)) | "The account, sign-in, your Library, Friends, your reading page and the emails with sign-in codes" | add "buddy reads" after "Friends," / "Buddy-Reads" nach "Freunde," |
| 7 | `privacy.ts:56` / `:200`, "What you show to others … happens only because you switch it on or accept a request" | no buddy reads | EN: "(a public account, accepted followers, profile links, a reading page, a shared review, a buddy read you join)" and "because you switch it on, accept a request or join"; DE: "(… eine geteilte Rezension, ein Buddy-Read, dem du beitrittst)" und "weil du es einschaltest, eine Anfrage annimmst oder beitrittst" |
| 8 | `privacy.ts:76` / `:220`, **Other members** | "see only what you choose to show (see Friends and your reading page above)" / "(siehe Freunde und deine Leseseite oben)" | "(see Friends, your reading page and the buddy reads you join above)" / "(siehe Freunde, deine Leseseite und die Buddy-Reads, denen du beitrittst, oben)" |
| 9 | `privacy.ts:111` / `:255`, retention of "Your account and everything in it" | lists Library, sessions, … activity and sign-in | add "buddy read memberships, messages, reactions" / "Mitgliedschaften, Nachrichten und Reaktionen in Buddy-Reads"; add a line for **ended buddy reads**: "kept until the last member leaves or deletes her account, then deleted" / "bleiben, bis das letzte Mitglied austritt oder ihr Konto löscht, dann werden sie gelöscht" |
| 10 | `privacy.ts:14` and `:158`, the version lines | `Version: 30 October 2026` / `Stand: 30. Oktober 2026` | the release's date (the file says "a new version date", `docs/legal-checklist.md`) |
| 11 | `README.md:16`, *Friends, by choice* | "Your switches decide what followers see…" | keep, add one more bullet after it: "- **Buddy reads, by choice.** Read one Book with friends in Sections, with a thread per Section that stays veiled until you have read it. The only thing about your reading it shows is which Section you are in." |
| 12 | `README.md:22`, *Your data is yours* ("the people she follows see what they chose to show") | silent on buddy reads | append "; in a buddy read she joined, its members also see which Section she is in (never a page), until she leaves" (README holds one line per service: no variables, no setup; `AGENTS.md`) |
| 13 | `docs/proposals/social.md:247`, "Never shown, whatever the switches: her address, progress and reading days (…)" | an absolute | "Never shown **to followers**, whatever the switches: …; progress is shown only inside a buddy read she joined, as a Section (§8, idea 5)" |
| 14 | `docs/proposals/social.md:300`, the activity table: "progress stays private (it already is on the reading page)" | | "progress stays out of the feed and the reading page; a buddy read shows a Section to its members" |
| 15 | `docs/proposals/social.md:660`, idea 5: "Each sees the other's progress bar… Progress leaves the database only here, only with both opting in." | the 2-person bar design | rewrite to the shipped design: "a buddy read of up to 12; its members see each other's **Section**, never a bar, a page or a percent; a thread per Section that stays veiled until you have read it (docs/plans/buddy-read-shared.md)". `:680` ("Progress stays private except inside a buddy read") is already consistent: leave it |
| 16 | `docs/proposals/social-v1-contract.md:672` (a copy of the `privacy.never` copy key) | the old sentence | the new EN sentence of item 1, so the contract matches the app |
| 17 | `CONTEXT.md` (**D1 writes it, not P1**): new terms *Buddy read*, *Host*, *Section*, *Position (where she is)* | none | include the rule as the term's definition: "**Position** — the Section a Member is in, worked out from her progress or set by her; the only thing about her progress that leaves her account, and only to the members of a Buddy read she joined, while she is in it." DE glossary words: *Buddy-Read*, *Abschnitt*, *Host* (Q-h) |
| 18 | `docs/parity.md` (new entries by W3–W5, not P1): every buddy-read screen says "Section only" in its Edge cases | — | each entry cites part 5.5 |

### 6.2 Checked, still true, no change

| Where | Why it stays |
|---|---|
| `SPEC.md:172`, *Sharing (#171)*: "Never her address, id, notes, highlights, progress or an unshared review" | about the public reading page, which stays progress-free |
| `docs/proposals/social-v1-contract.md:278`, `docs/proposals/social-v1.md:131,137`, `docs/proposals/social/mock.html:347` ("Never her reading days or progress") | the follower's profile, true; `mock.html:521` is a throwaway mock of v1: left as it is |
| `web/app/pages/friends/[member]/index.vue:11`, `…/[year].vue:5`, `web/app/components/friends/MemberCovers.vue:3`, `docs/parity.md:592` | comments and docs of the follower view; true |
| `web/app/legal/privacy.ts:37`/`:181` (reading page: "never your email address, notes, highlights or a review you did not share") and `en.json:1625` (`sharing.never`) | progress is not named there and is not on the page |
| `supabase/migrations/20261017040000_social_readers.sql:31` ("What never leaves, whatever she switches on: … her progress …") | **an applied migration is never edited**; the follower functions still return no progress (D1's regression test); D2's migration header states the exception, and `comment on function` there says so for `buddy_read()` |
| The pgTAP files that assert follower-facing functions hide progress (`social_readers_test.sql`, `social_v2a_test.sql`, `reading_pages_test.sql`) | enforcement of the follower surface, unchanged; **no test asserts the old sentence's words** (searched `web/tests`, `web/e2e`, `supabase/tests`; `web/tests/legal.test.ts` checks structure only) |

### 6.3 Outside this repository

- Draft PR #333 and the branch `plan/buddy-read` contain "What never leaves … her progress" in `docs/plans/buddy-read.md`: close it after #468 (O7).
- The phase-1 appendix of this file quotes the old promise in two places (risks and the old plan's statements); they are history and are marked as such.

## 7. The screens: copy and accessibility rules for W2–W5

Built from the base, nothing copied (`web/AGENTS.md`: "nothing of the app replaces it"): `UiChatThread`, `UiBubble` (`veiled`, `face`, `actions`), `UiComposer`, `UiReactionBar` (one reaction), `UiThreadRow`, `UiCheckList`, `UiAvatarStack`, `UiSheet`, `UiConfirm`, `UiSegmented`.
- **Words:** every string is a key in `web/i18n/locales/en.json`, German by `pnpm i18n:translate`; new base words (`ui.text.chat.*`) already have lines in `web/app/utils/uiText.ts`. Glossary: *Buddy read / Buddy-Read*, *Section / Abschnitt*, *Host* (Q-h), *Before we start / Vor dem Start*, *The whole book / Das ganze Buch*, "Show anyway / Trotzdem öffnen", "Where are you? / Wo bist du?". The owner's informal "du" in German.
- **Veiled rows** say why in text (a lock icon is never the only cue): "Section 9, hidden, 12 comments"; a veiled Section never shows its label, avatar-of-who-is-there beyond a count, or an unread dot.
- **a11y:** the thread is `role="log"` with polite announcements for arriving messages only; every long-press has a focusable ⋯; 44 px targets; 360 px with no sideways scroll (`docs/DESIGN.md`); text at 200 % reflows; Reduce Motion respected; one `docs/parity.md` entry per screen with states, copy keys, test ids. Accessibility scans run in the dark theme of the one flow (`docs/TESTING.md`).
- **The invite link page** is behind sign-in (it is not a public path): `web/app/utils/publicPath.ts` is untouched.

## 8. Order and dispatch table for the coordinator

Tiers: **hard** = Opus 5.5 `high`; **normal** = the coordinator's normal tier; **S-high** = Sonnet 5.5 at `high` where the work is subtle SQL or iOS timing and the cheaper model has failed before (my judgement, not measured here). One Opus at a time (D1, then D3); the Claude Max 5x note in the coordinator's rules makes that cheap to keep.

| Wave | PR | Repo / branch | Tier | Needs | Owns (no other PR touches these) | Spec |
|---|---|---|---|---|---|---|
| **0, now** | **D1** | libellus `feat/buddy-read-db` | **hard** | — | `supabase/migrations/20261113010000_*`, `supabase/tests/buddy_reads_test.sql`, `supabase/schema-snapshot/**`, `CONTEXT.md` | [`D1`](buddy-read-specs/D1-database-rooms.md) |
| **0, now** | **S1** | trappist `refactor/chat-layer-names` (draft) | normal | — | `web/layers/chat/**`, the Trappist files that import it, `web/tests/chat-layer*.test.ts`, `docs/plans/groups.md` | [`S1`](buddy-read-specs/S1-trappist-layer-names.md) |
| **0, now** | **W1** | libellus `feat/buddy-reads-switch` | normal | — | `web/app/utils/buddyReadsSwitch.ts`, `stores/buddyReadsSwitch.ts`, `components/profile/Account.vue`, the `profile.*` keys, a parity paragraph, its test | [`W1`](buddy-read-specs/W1-profile-switch.md) |
| **0, now** | **P1** | libellus `docs/progress-promise` | normal | — | `web/app/legal/privacy.ts`, the `privacy.never` key, `SPEC.md`, `README.md`, `docs/proposals/*`, `docs/parity.md:619`; **not** `CONTEXT.md` | [`P1`](buddy-read-specs/P1-progress-promise.md) |
| 1 | D2 | libellus `feat/buddy-read-position` on D1 | S-high | D1 | `20261113020000_*`, `buddy_read_position_test.sql` | paragraph in part 3 |
| 1 | D3 | libellus `feat/buddy-read-messages` on D1 | **hard** | D1 merged (Opus slot free) | `20261113030000_*`, `buddy_messages_test.sql` | part 3, part 4 |
| 1 | S2 | trappist `refactor/chat-layer-live` on S1 (draft) | S-high | S1 | `layers/chat/app/utils/liveChannel.ts`, `data/realtime.ts`, `stores/realtime.ts`, `tests/realtime.test.ts` | part 3 |
| 1 | S3 | trappist `refactor/chat-layer-utils` on S2 (draft) | normal | S2 | `data/photo.ts`, `data/klipy.ts`, `data/chat.ts` (error list only), the layer's `utils/photo.ts`, `klipy.ts`, `errors.ts` | part 3 |
| 2 | D4 | libellus `feat/buddy-read-realtime` | S-high | D2, D3 | `20261113040000_*`, `buddy_realtime_test.sql`, `docs/OPERATIONS.md` Realtime paragraph | part 3 |
| 2 | S4 | fabkho/chat `main` | normal | S2, S3, O1 | the whole new repo | part 3 |
| 3 | S5 / S6 | trappist `chore/chat-package` (draft) / libellus `feat/chat-package` | normal | S4 released | S5: Trappist `web/package.json`, `vitest.config.ts`, `nuxt.config.ts`, `.github/**`; S6: Libellus `web/package.json`, `nuxt.config.ts`, `vitest.config.ts`, `.github/scripts/ui-bump.sh`, `ui-bump.yml` | part 3 |
| 3 | W2 | libellus `feat/buddy-reads-data` | normal | D1–D4, S6 | `web/app/data/buddyReads.ts`, `buddyLive.ts`, `stores/buddyRead.ts`, `tests/buddy-*.test.ts` | part 3 |
| 4 | W3, W4 | libellus `feat/buddy-reads-setup`, `feat/buddy-reads-room` | normal | W2 (W4 also D3) | `components/together/**`, `pages/t/**`, `pages/together/**`, `utils/pendingBuddyRead.ts`, `middleware/auth.global.ts` (W3), `e2e/buddy-read.spec.ts` (W4); the two can run in parallel, they share `docs/parity.md` and `en.json`: the second to merge re-runs `pnpm i18n:translate` | part 3 |
| 5 | W5 | libellus `feat/buddy-reads-entries` | normal | W3 | `pages/book/[key].vue`, `components/home/**` | part 3 |
| 6 | **Release 1** | libellus | owner | all of the above, O3, O5, O6 | — | part 9 |
| 7 | K1, X1–X3 | libellus | per spec | release 1, O4 | — | part 3 |

**Parallel starts and their conflicts.** The four wave-0 PRs touch disjoint files except `web/i18n/locales/{en,de}.json`, `web/.i18n-kit.lock.json` and `docs/parity.md` (W1 adds `profile.*` keys and a paragraph; P1 changes one key and one line):
merge W1 first (it is small), P1 rebases and re-runs `pnpm i18n:translate`. `CONTEXT.md` belongs to D1 alone.

**What the coordinator should check at each step.** D1/D3: that `supabase test db` and the snapshot check are green in the PR's `check` job (not only locally); S2: the owner's phone check; S4: the install-from-GitHub acceptance; W4: the `full-e2e` label before merge; release 1: part 9.

## 9. Risks, rollback and the release plan

### 9.1 Behind a switch, and what that does and does not protect

- **The switch is a device setting, default off in release 1** (`libellus.buddyReads`, like `libellus.friendsTab`, `docs/parity.md` "Tab shell"; W1). Off: no Book row, no Home card, no invitation row, no route reached from the app, no buddy RPC called. The database objects exist for everyone from the migration on, but a member cannot be in a room unless a host invited her or she opened a link, and the host must follow her (or she must hold the link): exposure is the owner and friends.
- A switch on a device is **not** a privacy control for someone already in a room (part 5.5): turning it off while in an active room is refused with a "Leave first" confirm. Flipping the default to on is a later release (a constant in W1), after a week of use.

### 9.2 Release mechanics (`docs/OPERATIONS.md`, "Releases")

Merging PRs into `main` changes nothing members see. Release 1 is the release-please PR: `release.yml` runs the flows (every flow, `@full` included, so W4's flow), then `deploy`: `supabase db push --linked --include-all` (the four migrations, after a dry run printed in the summary), functions (none changed), then the `production` branch moves and Cloudflare Pages builds. Migrations are **additive**: new tables and functions, a widened `feedback_kind` check, an extended `private.can_see_photo`, two triggers; the running bundle ignores all of it, so the database-first order is safe ("a column is added before the app reads it").

### 9.3 Rollback, forward-only

- **The web app:** Cloudflare Pages "Rollback" in one click, or the release workflow's rollback to an older tag with `migrations` off (`docs/OPERATIONS.md`, "Deploying a tag by hand"): the old bundle does not touch the new objects.
- **The feature, quickly:** the default is already off; if a bug is in the server, a *new* migration revokes `execute` on `create_buddy_read`, `join_buddy_read`, `invite_to_buddy_read` from `authenticated` (and, if needed, drops the two progress triggers). The repo's rule stands: an applied migration is never edited; a wrong one is corrected by the next (`AGENTS.md`).
- **The two riskiest pieces:** the `reading_sessions` trigger (a hot table; one index probe when no room is linked; D2 pgTAP and the existing progress tests prove it is a no-op for members in no room) and the `private.can_see_photo` extension (read by the avatar storage policy; D1 tests who can and cannot see a photo before and after). Both are small, both have a documented off-switch migration.
- **Data cannot be un-leaked:** the only new exposure is the Section, to a room's members; the pgTAP regression and D4's payload test guard that no page, percent or fraction ever travels.

### 9.4 What to watch after release 1

- `client_errors` for the routes `/together/*` and `/t/*` (the owner's screen `web/app/pages/profile/errors.vue`; `docs/OPERATIONS.md` "Client errors"); Sentry (`scrubEvent`: a message body must never be in an event: W2's store keeps bodies out of error text; test it);
- the `feedback` inbox for `report` rows (`web/app/pages/profile/feedback.vue`);
- Supabase dashboard, hosted project: **Realtime messages a month** (Free: 2 M; a post to 11 others is 12), **peak concurrent connections** (Free: 200; one per device with a room open), database size (500 MB), egress (5 GB; text and GIF URLs add almost none), edge function calls (no new ones). The Free numbers are from the old plan's cost table, read from supabase.com on 12 October 2026 and **not re-checked for this plan**; for the owner and friends they leave two orders of magnitude of room.
- `docs/OPERATIONS.md` "Supabase advisors": the advisor run after D1–D4 (new foreign keys are all indexed; every function has a pinned `search_path`).

### 9.5 Should a staging Supabase project (#177) come first?

**Recommendation: not the full #177 first; a scratch hosted project for D4 only, before release 1.** Reasons:
1. The one thing the local stack may not prove is **hosted Realtime Authorization** for private channels together with the hosted "Allow public access" setting (O3). I did not test whether `supabase start` enforces the same setting; treat as unknown. D4's policy is the first of its kind in this repo (`grep -rn "realtime.messages" supabase/migrations` is empty).
2. The migrations are forward-only; a mistake in a policy on `realtime.messages` or in a trigger on `reading_sessions` costs a corrective release.
3. #177 (staging: a second Supabase project plus `main` deploying to a staging URL, `gh issue view 177`) is a pipeline: secrets, a Pages branch deployment, env vars, test data, documentation — about a day of work and ongoing care; Pages previews have **no backend** today (`docs/HOSTING.md`), so it would be new infrastructure. The owner said "staging yes, but later" (the issue's text).
4. A scratch Free project costs nothing and an hour: push the four migrations to it with `supabase db push --db-url`, set O3 there, open two browsers on the local app pointed at it (`NUXT_PUBLIC_SUPABASE_URL` and key as exported env vars), run W2's live test and the import job's live feed once with public access off, then delete or keep it. It pauses after 7 idle days (#177).
If the owner prefers the full #177 first, release 1 slips by about a day of #177 work and the first release is a clean dress rehearsal; if neither, release on a quiet day, run `full-e2e` first, and do O3 only after two real devices have chatted through D4's policy with public access still on.

### 9.6 Risks and mitigations

| Risk | Mitigation |
|---|---|
| The layer was built for one consumer (Trappist-isms) | Libellus writes W2 against 0.1.0 first; whatever it cannot say becomes 0.2.0 while both apps are small consumers |
| Trappist's chat moves weekly (`stores/chat.ts` was touched 17 times since 8 Oct) | S1–S5 stack as drafts; the squashed import pins a sha; S5 re-bases; both apps pin an exact tag |
| iOS PWA socket revival cannot be tested in CI | S2 keeps the unit tests; the owner checks a real phone; the layer keeps the 3 s cold start |
| Free plan limits (Realtime connections and messages, egress) | lazy single channel per device; no photos in v1; watch list 9.4; Pro is an owner decision with X3 |
| Two spoiler models (client veil vs server gate) | Q8: client veil; the visibility hook is left in the layer (`ChatRecord.hidden` stub) for a server stub later |
| Progress leaving the account for the first time | P1 and part 5.5; D1/D2/D4 tests that no number travels; the switch cannot be turned off while in a room |
| `can_see_photo` widened | tested both ways in D1; it adds co-members only, while joined, no block |
| An old bundle talking to a newer database after the app-update sheet | all changes additive; no RPC signature is changed after release 1 without a new name |
| Layer or UI-base bump breaks an app | exact pins, one bump PR per package (`ui-bump.yml`), checks run on the bump branch |
| Hosted project pauses after 7 idle days (Free; #177) | already true of the app; not new |

## 10. What still needs the owner, and what I could not verify

### 10.1 Owner decisions still open (few; each has my default, used unless you say otherwise)

1. **Q-a. Staging:** a scratch Free project for D4 before release 1 (my default), or the full #177 first, or neither (part 9.5).
2. **Q-b. A link or invitation opened with the switch off:** ask once "Turn on Buddy reads?" and turn it on (default), instead of refusing.
3. **Q-c. The switch while in a room:** it cannot be turned off without leaving (default; part 5.5), or it may be turned off and the rooms keep sharing her Section (not recommended).
4. **Q-d. Leaving and deleting:** leaving a room keeps her messages unless she ticks "Also delete my messages" (off by default); deleting her account deletes her messages (Trappist keeps them anonymised; the old plan deleted).
5. **Q-e. Hand override means "at least this far":** it can open more, never hide what her progress already opened (part 5.3). And a member who finished the Book **before** joining gets nothing opened automatically and is offered "I've already read it".
6. **Q-f. The report reasons** (harassment, spam, inappropriate, other) and that a reported message's text is sent to the owner with the report (already in P1's privacy text).
7. **Q-g. German word for *Host*:** "Host" (default, neutral loanword) or a gendered "Gastgeberin/Gastgeber" (the old plan's draft). *Section* is "Abschnitt" and *Buddy read* "Buddy-Read" as you decided.

### 10.2 Not verified, and why

- A real `github:fabkho/chat#vX` install and a Cloudflare Pages build: the repo does not exist yet (the spike used a `file://` git repo; the public `fabkho/ui` route was proven end to end, part 2 A).
- Whether the **local** Supabase stack enforces hosted Realtime's "Allow public access" setting and private-channel authorization the way hosted does; the exact dashboard wording of that setting (from the old plan, from memory).
- The entry-chunk guard's exact hook (S6 specifies the behaviour; the PR proves it fails on purpose); `#path:` subdirectory installs from GitHub; a sub-layer inside the real `@fabkho/ui` (only a simulation, part 2 C).
- The Free-plan quotas (old plan's table, 12 October, from supabase.com): not re-read.
- Trappist's `git subtree split` (S4 uses a squashed import instead); the behaviour of Trappist's PWA on a real phone after S2 (the owner's check).
- Estimates (dates, sizes) are judgement, not measurement.
- I did not run any migration or the pgTAP suite: this turn is documentation only; part 4's SQL is a design, not tested code.

---

# Appendix A: phase 1 findings (unchanged)

The text below is the phase-1 report as accepted on 2 November 2026, unchanged except that its headings are one level deeper. Where this plan and the appendix differ, this plan wins (the appendix's question 1–20 are answered in part 0).

## Buddy reads again, starting from what Trappist already has (phase 1: findings, sharing options, questions)

**Status: phase 1 of a plan, for the owner's answers. No code, no build plan yet.** Read on 2 November 2026.
Libellus side: `origin/main` at `78e974e4` (1.31.0). Trappist side: `/Users/fabkho/code/trappist`, `07eab300`
(1.30.4, 31 October 2026; two newer commits on its `origin/main` are CI-only), read only. `@fabkho/ui` was read at
`origin/main` (`11dd8ab`, release 0.10.6; the local checkout is 57 commits behind, so every claim about it is from
`git show origin/main:…`). Regal at `2eb5953`. Paths without a repo name are Libellus; `trappist:` and `ui:` paths are
read only.

The earlier plan, [`docs/plans/buddy-read.md`](https://github.com/fabkho/libellus/blob/plan/buddy-read/docs/plans/buddy-read.md)
on branch `plan/buddy-read` (draft PR #333, 12 October, 706 lines), is a different history and is not built on. It is
quoted as "the old plan" with its section letters.

### Headline

1. **Trappist already built what the old plan wanted to build, and more.** Groups of up to 30 members, **buddy reads
   inside a group** with a comment thread per chapter, chapter markers ("read through chapter n") that veil the later
   threads, GIFs, photos, reactions, replies, reports, push and mute, live updates. Merged 22–29 October 2026 as work
   packages G0–G12 (`trappist:docs/plans/groups.md`, "Work packages"; 268 commits since the old plan's audit
   commit `0f3c2af`, 8 October). The old plan said "Trappist's chat is strictly 1:1". It is not any more.
2. **The presentational chat is already shared**: it moved into `@fabkho/ui` on 19 October (`trappist:ae5aea9e`, #298).
   Libellus is on 0.10.6, has the base's chat words wired for English and German (`web/app/utils/uiText.ts`,
   `web/app/plugins/ui-text.ts`) and uses none of the chat components yet. Everything the old plan §E called "copy
   `ChatMessage.vue`, `ChatComposer.vue`, `ChatGifPicker.vue`, …" no longer exists in Trappist.
3. **The client logic is half extracted, and Trappist wrote down how to finish it.** `trappist:web/layers/chat/` is a
   local Nuxt layer (1,136 lines: send queue, thread merge, spoiler veil, chapter division, an adapter contract),
   guarded by a test so that it imports nothing from the app, built "so it can leave the app by a subtree split like
   `@fabkho/ui` did" (`groups.md`, "Port to BetterReads"). The Realtime wrapper with the iOS fixes, the photo
   resizer and the GIF client are still in Trappist's app and still entangled with its domain.
4. **The database cannot be shared as code and Trappist already says so** ("The database stays per app", same
   section). What can be shared is the behaviour, written down as pgTAP and a checklist of the bugs it paid for.
5. **The product models differ**, and that is the real decision: Trappist veils chapters in the *client* from a
   *hand-set* marker and "tracks nothing"; the old plan gated in *SQL* per message from *automatic* reading
   progress. Libellus has the progress, the ebook reader and a smaller circle. Questions 7–9 below.
6. **Recommendation:** finish Trappist's own plan. Make `web/layers/chat` a small public, tag-pinned `fabkho/chat`
   package (the `@fabkho/ui` way, not Regal's branch way), let Libellus be its second consumer, write Libellus' SQL
   by hand against Trappist's snapshot, and keep Trappist's veil model for v1. Part 3.

---

### 1. What Trappist has, today

#### 1.1 Timeline (commit dates, `git log` in Trappist)

| Date (2026) | What | Where |
|---|---|---|
| 8 Oct | KLIPY replaces GIPHY, **the `gifs` Edge Function is deleted**; sweep of orphaned chat media | #120 (`0ff98af2`), #116 |
| 8–14 Oct | reactions, double-tap ❤️, voice messages (≤ 2 min), replies ("answer one message"), Feed | #96, #130, #143, #235, #209 |
| 19 Oct | **the chat UI moves to `@fabkho/ui`**, `ChatMessage`, `ChatComposer`, `ChatGifPicker`, `ChatMediaViewer`, `ChatQuote`, `ChatVoiceBubble`, `timeline.ts`, `reply.ts` deleted from the app | #298 (`ae5aea9e`, −3,741 lines) |
| 20–22 Oct | plan for group chats and buddy reads; groups in the database and the app (G0–G5, G7, G8) | #314, #316–#325 |
| 23 Oct | **buddy reads in the database (G11) and the app (G12)**; group picture; Orga counts | #328, #330, #329, #334 |
| 28–29 Oct | custom chapters ("Prolog", "Zwischenspiel") anywhere; follow-ups (live invitation nudge, large text) | #337, #338, #344 (`c2805bff`, 29 Oct, carries `20270514120000_group_followups.sql`) |

(The migration *file names* run ahead of the commit dates, `20270502…` to `20270514…` are all 22–29 October; the
sequence is Trappist's own and does not interact with Libellus' `202611…` numbers.)

#### 1.2 Database (source: `trappist:supabase/schema-snapshot/`, the generated current state; migrations for history)

**Shape.** One message table for 1:1 and groups:

| Table | What | Evidence |
|---|---|---|
| `conversations` | `kind` in `connection`, `host`, `group`; `member_a`/`member_b` for 1:1, null for groups (`conversations_group_shape`) | `schema-snapshot/tables/public.conversations.sql` |
| `messages` | `kind` text, phone_share, system, media, book; `client_id` (unique per sender); `created_at default clock_timestamp()`; media columns (`media_kind` image, gif, voice; `media_path` or `media_url`); `reply_to`; `chapter_id`, `spoiler`; `hidden_at` (the Orga); system-line people | `…/public.messages.sql` |
| `message_reactions` | one of six emoji per member and message, key `(message_id, account_id)` | `…/public.message_reactions.sql` |
| `chat_groups`, `chat_group_members` | group = title, photo, `history` (`all` / `since_join`), `entry_closed`; member = `role` admin/member, `joined_at`, `left_at`/`left_reason`, `last_read_at` (the unread cursor), `muted_until`; at most 30 | `…/public.chat_groups.sql`, `…/public.chat_group_members.sql` |
| `buddy_reads` | belongs to a group; a book *snapshot* (`book_title`, `book_author`, `book_cover`, `book_isbn`, no FK to a catalogue), `status` active/finished/archived, `chapters_from` count/pages; at most 3 active per group | `…/public.buddy_reads.sql` |
| `buddy_read_chapters` | `position` 1–101, `kind` chapter/end, `title`, optional `start_page`/`end_page`; unique `(buddy_read_id, position)` deferrable | `…/public.buddy_read_chapters.sql` |
| `buddy_read_marks` | one row per member and buddy read: `read_through` 0–100 (chapter number, **never a page**) | `…/public.buddy_read_marks.sql` |
| `buddy_read_cursors` | `(chapter_id, member_id, last_read_at)`: unread per chapter | `…/public.buddy_read_cursors.sql` |
| `chat_media_trash`, `chat_group_rate_log`, `reports` | storage sweep queue; group create/add limiter; reports with `message_id` and `item_kind` post/comment/message | `…/tables/` |

**Grants, as Libellus wants them.** `authenticated` can *select* `conversations`, `messages`, `message_reactions` and
`reports` (1:1 rows by the policy `conversation_party`, which is false for group rows because their `member_a`/`member_b`
are null), and *write* `message_reactions` directly. The group and buddy-read tables have **no** `authenticated` grant
at all (`schema-snapshot/grants/tables.sql`): every group read goes through set-based `security definer` RPCs
(`group_messages_readable`, `group_info`, `buddy_read`, `group_buddy_reads`). That is Libellus' own rule ("every read and write
through `security definer` RPCs", `AGENTS.md`), so the *group* half ports directly; the 1:1 half (policy reads, reactions
written into the table) does not.

**The behaviour worth keeping** (the "gotchas Trappist already paid for"; each with where it lives):

- **Order.** `created_at` defaults to `clock_timestamp()` (`20261110150000_messages_clock_order.sql`); `post_message`
  stamps `greatest(clock_timestamp(), max(created_at) + 1 µs)` per conversation under an advisory lock
  (`20261110160000_messages_written_order.sql`; current body in `schema-snapshot/functions/public.post_message(uuid,text,…).sql`).
- **Idempotent send.** `unique (sender_id, client_id)` (`messages_client_once`); `post_message` takes
  `pg_advisory_xact_lock('message_sender:'||uid)`, returns the existing row on a retry, refuses a reused
  `client_id` for another conversation or kind (`message_client_id_reused`).
- **Race with removal.** After the sender lock it takes `message_conversation:<id>` and checks `conversation_writable`
  again, so a message that passed the gate while an admin was removing her is refused, not written after she left
  (comment in `post_message`).
- **Rate limit.** 30 messages a minute counted inside `post_message`; groups and adds have `chat_group_rate_log`.
- **Replies stay inside their thread** (`message_reply_unavailable`).
- **Chapter comments are messages with `chapter_id`**; `group_messages_readable` returns the group chat only unless a
  chapter is asked for, so `inbox()` and unread counts ignore chapter comments without being touched
  (`20270509120000_buddy_reads.sql`, 107 KB, the largest file; see also `groups.md`, "As built in G11").
- **Realtime auth.** Policy `realtime_member_topic_select` on `realtime.messages`: a member may join her own topic
  `member:<id>` only, there is **no insert policy**, only triggers send (`20261110140000_realtime_member_channels.sql`).
  `messages_broadcast_new` sends the **whole row** to every active member through `group_recipients` (blocked pairs left out);
  event name `message.new` or `chapter.message.new` (`schema-snapshot/functions/public.messages_broadcast_new().sql`).
  Trappist has 13 typed events (`data/realtime.ts`, `RealtimeEvent`); the chat's are `message.new/read/reaction`,
  `chapter.message.new/read/reaction`, `group.changed`, `group.invitation`, `buddy_read.changed`, `message.hidden`.
- **Media.** Private bucket `chat-media`, 2 MB, jpeg/webp/gif, path `{conversation}/{sender}/{uuid}.ext`
  (`20270112120000_chat_media.sql`); storage policies `chat_media_insert_own`, `…_select_parties`, `…_delete_own`
  (`schema-snapshot/policies/storage.objects.sql:23–30`); the object must exist with a matching type and be hers before
  `send_media` accepts it. Deleted messages and accounts queue paths in `chat_media_trash`; the hourly cron
  `sweep-chat-media` (`schema-snapshot/cron/jobs.sql`) calls the Edge Function `chat-media-sweep`
  (`index.ts` 80 + `sweep.ts` 60 lines, pure and tested). GIFs are **not** stored: `messages.media_url` holds KLIPY's
  address and the database accepts only `https://static*.klipy.com/…` (`20270305120000_klipy_gifs.sql`, constraint
  `messages_media_shape`).
- **Reports.** `report_chat_message(uuid,text,text)` writes `reports.message_id` with an excerpt that names the chapter
  (`chapter_label`); reasons are fixed (`reports_reason_known`: belaestigung, spam, unangemessen, fake, sonstiges);
  the Orga (Trappist's admin) can hide and unhide (`admin_hide_message`, `messages.hidden_at`).
- **Blocks.** Symmetric and silent (`20261201120000_blocks.sql`; `blocked_between`, `visible_between`). Inside a group
  nobody is removed; the two stop seeing each other's messages and reactions (`groups.md`, D6).
- **Push.** A general pipeline: `push_events` + `push_wanted` + `push_enqueue(_many)` + the Edge Function `push`
  (`index.ts` 159, `payload.ts` 342 lines) + `web/public/push-sw.js` (331). Kinds include `group_message`,
  `chapter_reply` (only when someone answers *your* comment, D22), `group_invite`.

**Size.** About 110 of Trappist's 332 database functions match chat, group, buddy, conversation, message or reaction
(about 3,600 lines of function bodies; a few are Feed reactions). The chat-related pgTAP files total 4,452 lines
(`messages_test.sql` 369, `message_reactions_test.sql` 206, `chat_media_test.sql` 247, `chat_voice_test.sql` 283,
`message_reply_test.sql` 215, `chat_groups_test.sql` 1,190, `buddy_reads_test.sql` 831, `reports_test.sql` 391,
`realtime_test.sql` 377, `klipy_gifs_test.sql` 138, `chat_media_sweep_test.sql` 205, all in `trappist:supabase/tests/`).

#### 1.3 Edge functions

- **`gifs` is gone.** KLIPY's terms ask that requests and media come from the member's phone and that nothing is copied or
  proxied, so the picker talks to KLIPY directly (`trappist:web/app/data/klipy.ts`, 244 lines; its header says so).
  Functions today: `books`, `chat-media-sweep`, `push`, `screens`, `send-auth-email` (`trappist:supabase/functions/`).
  The old plan's "port the `gifs` function, or a Pages function proxy" is dead.

#### 1.4 Client code

| Piece | Path (trappist:web/…) | Lines | Generic or domain |
|---|---|---:|---|
| Send queue (outbox, order, back-off, `client_id`, refusals, Web Locks tab ownership) | `layers/chat/app/utils/queue.ts` (re-exported by `app/data/saveQueue.ts`, `queueOwnership.ts`) | 537 | **generic**, in the layer; storage and the send are injected |
| Thread merge by `clientId`, runs, unread after a cursor | `layers/chat/app/utils/thread.ts`, `composables/useThread.ts` | 127 + 23 | **generic**, in the layer; imports only `@fabkho/ui/pure/timeline` |
| Spoiler veil (`chapterOpen`, `chapterView`, `mayLoadMedia`, peeks in `localStorage`) | `layers/chat/app/utils/veil.ts`, `composables/useBuddyRead.ts` | 105 + 51 | **generic** (rule: "drawn by the app, not enforced by the database") |
| Chapter division (count with grouping, pages) | `layers/chat/app/utils/chapters.ts` | 102 | generic; the server repeats the arithmetic (`set_buddy_chapters`) |
| Call-card state machine | `layers/chat/app/utils/inviteState.ts` | 44 | **Trappist** (the Feed call: `authorWaiting`, `authorCanCreate` …), sits in the layer anyway |
| Adapter contract (`ChatAdapter`, `GroupAdapter`, `BuddyReadAdapter`, `InviteAdapter`) | `layers/chat/app/types/adapter.ts` | 140 | generic, types only; `live()` abstracts the transport |
| **Realtime wrapper** (join a private topic, status, resync on rejoin, a 3 s cold-start resync, replace a dead iOS-PWA socket on `online`/`visibilitychange`) | `app/data/realtime.ts`, `app/stores/realtime.ts` | 279 + 196 | mechanics **generic**, but the event union carries Feed and connection events, imports `toMessage` from `data/chat.ts`, and the store is Pinia. **Not in the layer.** |
| Photo prepare (≤ 1600 px, 1280 in groups, JPEG ≤ 2 MB, EXIF/XMP strip for Safari's encoder) | `app/data/photo.ts` (`data/chatPhoto.ts` is a 3-line re-export; the Feed uses it too) | 177 | **generic**, framework-free, tested. Not in the layer. |
| GIF client (search, trending, share count, response mapping, `customer_id`) | `app/data/klipy.ts` | 244 | generic provider code, with `LOCALE = 'de'`, German topic chips and `translateChatError` baked in. Not in the layer. |
| Repository (RPC wrappers, signed URLs `MEDIA_URL_SECONDS` = 15 min, error mapping) | `app/data/chat.ts`, `groups.ts`, `buddyReads.ts`, `inbox.ts` | 711, 515, 267, 396 | **per app**: it *is* the adapter's implementation; German error sentences, `Gelöschtes Mitglied` |
| Chat store (optimistic send, uploads, signing, quotes, reactions, drafts, cursors, phone share, `companions`) | `app/stores/chat.ts` | **1,848** (1,094 in the old plan) | per app (Pinia); the largest un-shared piece; 1:1 parts (`companions`, `readKey`, `phone_share`) |
| Chat screen | `app/components/chat/ChatPage.vue` (+ `ChatGroupHead/Info/Mute`, `ChatSystemLine`, `ChatBookCard/Sheet`) | 997 (+ 461 info) | per app: composes `UiChatThread` + `UiBubble` + `UiComposer`; head, menus, report, Orga |
| Buddy read screens | `app/pages/lesen.vue`, `app/stores/buddyRead.ts`, `app/components/buddy/*` (pill, marker sheet, chapters sheet, insert, edit) | 323 + 324 + 573 | per app copy and flows; the chapter row is `UiThreadRow` in the base |
| Private-image cache rule (path-keyed Workbox cache so a re-signed URL is the same picture; the egress lesson) | `app/utils/storageCache.ts` | 131 | generic idea, wired into each app's own `nuxt.config.ts` Workbox config |
| Copy | `app/copy/chat.ts`, `groups.ts`, `buddyRead.ts` | 252 + 169 + 216 | **German only**, plain TS modules (no i18n); the base's words are `ui.text.chat.*` |

**Tests.** Vitest, chat-related: 19 files, 3,963 lines (e.g. `tests/realtime.test.ts` 244, `chat-layer-queue.test.ts` 315,
`chat-layer-queue-ownership.test.ts` 384, `klipy.test.ts` 282 with recorded answers, `chat-media.test.ts` 251,
`buddy-reads.test.ts` 320, `chat-store-buddy.test.ts` 233). The layer's own are 1,348 lines in 7 files, plain Node. The guard
`tests/chat-layer.test.ts` (120 lines) fails the build if a layer file imports the app, Pinia, Supabase or an auto-import, or
mentions a domain word.

#### 1.5 What is coupled to Trappist's domain, what is generic

- **Domain, not for Libellus:** 1:1 connections (`conversations.connection_id`, `kind connection|host`, `connections_open_conversation`),
  phone sharing (`member_phones`, `share_phone`, `ChatPhoneCard/Sheet`, `messages.kind = 'phone_share'`), the Feed call as
  the way into a group (`feed_book_joins`, `create_buddy_group`, `join_buddy_group`, `source_post_id`, `inviteState.ts`),
  the Orga and bans (`visible_between` includes bans and hidden admins; `admin_hide_message`), the book card in
  messages (`message_book_valid`, `bookMoment.ts` 279), groups by hand with admins, history windows, mute, group picture,
  German copy, `profiles`/`accounts` as identity, `profiles_before_delete` anonymisation.
- **Generic:** the send contract (`client_id`, order, rate limit, idempotency), the membership-gated reader, per-thread
  cursors, reactions, GIF provider, photo preparation, media policy shape, sweep, Realtime mechanics, the veil rule, the
  chapter arithmetic, the presentational UI, the scroll anchoring and day grouping (inside `UiChatThread` /
  `ui:app/utils/chat/timeline.js`).

---

### 2. A layer-by-layer sharing map

#### (a) Presentational UI: shared already, nothing to extract

`@fabkho/ui` at `origin/main` has, as components: `UiChatThread` (811 lines, runs, scroll anchoring, `banner` slot),
`UiBubble` (996; `sender`, `face` slot, `veiled` + `reveal`, `wide`, `actions`), `UiComposer` (517) + `UiComposerChip`,
`UiReactionBar` (227; **one** lit emoji, "a tap picks one, the same again takes it back"), `UiGifPicker` (258; takes a
`search(q, page, topic)` function and `feeds`, so it is provider-agnostic), `UiMediaViewer` (346), `UiQuote`, `UiVoiceBubble`,
`UiDaySeparator`, `UiAvatarStack`, `UiCheckList` (member picker), `UiThreadRow` (chapter/section row, a veiled row never has
its title), `UiImageCrop`. Pure helpers under `app/utils/chat/` (`timeline.js` 170, `reply.js`, `voice.js`, `message.ts`,
`gif.ts`, `words.ts`), reachable as `@fabkho/ui/pure/<name>`. Stories carry axe and keyboard tests. Words are
`ui.text.chat.*` (`ui:app/app.config.ts`), set by the app from its messages; **Libellus already does this**:
`web/app/utils/uiText.ts` lists the chat, `checkList`, `imageCrop` and `threadRow` keys and `tests/ui-text.test.ts`
fails when the base adds a word without a line.

Libellus' own rule applies unchanged (`web/AGENTS.md`): "Look there before writing a component … nothing of the app
replaces [the base]". One known knob: `ui.config.ts` holds back the base's `no-focus-zoom` plugin and says "once BetterReads
takes the base's composer, it comes back with it" (Trappist's 15 px composer needs it against iOS' focus zoom; Libellus' fields are 17 and 19 px).

What may still need the base: a **radio row** (Trappist's follow-up: `BuddyMarkerSheet` and `ChatGroupMute` are radio rows
in a sheet; `UiRow` has no radio mode), and a **multi-reaction** bar if the owner wants several emoji per member (Q13).
Both are small base PRs under the base's own rules (story, axe).

#### (b) Client logic: where the real sharing is

| Piece | Share? | How, and what must change first |
|---|---|---|
| queue, thread, veil, chapters, adapter types | **yes, already in the layer** | extract as is; rename `chapterId` to a neutral word before 0.1.0 if Libellus' "Section" matters in types (Q3); keep words out (the guard already does) |
| `inviteState.ts` | **no** | Trappist's call card; move it back into the app before the split |
| Realtime wrapper | **yes, the high-value one** | split mechanics from domain: `liveChannel({ loadRealtime, topic, parse })` with the join, status, resync on rejoin, 3 s cold-start resync and dead-socket replacement; Trappist's event union and Pinia store stay in the app. The loader is **injected**, because Libellus must reach the real client only through `#realtime-client` (`web/realtime.config.ts`, `web/AGENTS.md` "Gotchas": a new Realtime use "goes through that door, never through `client.channel()`; keep it lazy and off the entry") |
| Photo prepare | **yes** | move `photo.ts` into the layer unchanged (framework-free). Libellus has its own `data/avatar.ts` (424 lines, strips EXIF/XMP/ICC/IPTC from an avatar of at most 256 kB) and `utils/avatarRaster.ts`; leave them, adopt `photo.ts` only for chat photos |
| GIF client | **yes** | parametrise `locale`, topic list and error sentences (today `LOCALE = 'de'`, German chips, `translateChatError`); keep the recorded-answer tests |
| Error codes | **yes, codes only** | the SQL raises stable keys (`message_rate_limited`, `buddy_read_archived`, `message_client_id_reused`, …); the layer exports the key list, each app words it (Trappist: `data/chat.ts` `translateChatError` / `CHAT_ERROR_KEYS`; Libellus: `en.json` + `de.json`) |
| Repository (`data/chat.ts` …) | **no** | per app; it is the adapter |
| Stores, pages, sheets | **no, for now** | the chat store is 1,848 lines in Trappist; Libellus writes a smaller one on the layer's `queue`/`thread`. What the two stores then *both* contain is the next extraction (a `thread engine` in the layer), by evidence, not by guess |
| Private-image cache rule | later | only needed if Libellus serves private chat photos (Q15); then copy the 131-line rule into its Workbox config |

#### (c) The database: SQL cannot be an npm package

Options compared for this owner (solo, two schemas that differ at the identity table, the block and visibility predicates,
the rate-limit style and the "RPC only" rule):

| Option | What it is | Cost | Verdict |
|---|---|---|---|
| **1. Port by hand, Trappist's snapshot and pgTAP as the spec** | A worker writes Libellus-native migrations from `schema-snapshot/functions/…` and `supabase/tests/*`, with a header comment naming the Trappist commit and a checklist of behaviours to keep (part 1.2). | About 25–30 functions and 3 migrations for the Libellus shape; its tests start from Trappist's. No tooling. | **Recommended.** Matches Trappist's own plan and the migration rule in `AGENTS.md` (an applied migration is never edited; each repo evolves alone). |
| 2. Copy with a sync script | A script pulls named functions from Trappist's snapshot into a new Libellus migration. | The bodies reference `profiles`, `accounts`, `conversation_party`, `visible_between`, `blocked_between`; a search-and-replace is brittle, and a re-sync after an applied migration is a *new* migration of a diff. | No. |
| 3. Template generator | `fabkho/chat` ships `.sql.tpl` plus a hook file (member table, `can_write`, `can_read`, `blocked`), and a generator emits a dated migration and the pgTAP. | A week or more; the generator needs diff-and-upgrade logic to respect "never edit an applied migration"; only pays with a third app or frequent SQL change. | Not now. Revisit if a third app appears. |
| 4. A shared Postgres extension (database.dev / `pg_tle`) | Versioned, installable SQL with upgrade scripts. | From general knowledge, not tried here: objects live in the extension, the snapshot and drift checks of both repos (`supabase/schema-snapshot/`, CI "stale snapshot") would have to understand them, local stack parity is unproven, and the hooks would have to be config tables or functions in `public`. | No. |
| 5. A reference-SQL folder in the shared package | The snapshot functions copied under `fabkho/chat/reference/sql/` for reading, never applied. | Option 1 plus a place to read from without access to the private Trappist repo. | **Add it to option 1**, if the package is public (Trappist's repo is private, Libellus' is not). |
| 6. Accept the duplication | Same as 1, without the checklist. | The bugs repeat (ordering ties, the removal race, the replay of a `client_id`). | No: the checklist is the point. |

Libellus-specific SQL that has no Trappist counterpart is listed in part 4.

#### (d) Edge functions

- `gifs`: gone (part 1.3). Libellus needs **no** server part for GIFs; it needs a KLIPY app key of its own, the attribution
  ("Powered by KLIPY", `trappist:docs/parity.md` around line 874), a row in `docs/THIRD-PARTY.md`, a line in
  `web/app/legal/privacy.ts` and CSP entries (`connect-src https://api.klipy.com`, `img-src https://static*.klipy.com`;
  `web/public/_headers` has a Report-Only policy today).
- `chat-media-sweep`: **copy the shape, do not share.** The pure part (`sweep.ts`, 60 lines) has no domain; the SQL it calls
  (`chat_media_sweep_batch`, `chat_media_sweep_done`, the trash table) belongs to the schema. Only needed if Libellus gets photos.
- `push`: Libellus has its own Web Push sender for the import job (`supabase/functions/import-job/push.ts` 158 lines,
  `webpush.ts`) and Trappist has another (`supabase/functions/push/`). **Two implementations of the same RFC 8291 sender**
  already exist. Out of scope for this plan; worth one line in the owner's backlog.

#### (e) i18n copy

Trappist's copy is German-only TypeScript (`app/copy/*.ts`, 637 lines for chat, groups and buddy reads) and cannot move.
The shareable words are the base's English defaults and `ui.text.chat.*`, which Libellus already translates. Libellus'
own screens follow its rule: a key in `web/i18n/locales/en.json`, German by `pnpm i18n:translate`, both files and
`.i18n-kit.lock.json` committed, the parity test (`web/AGENTS.md`). Trappist's German is a useful glossary only: *Buddy-Read*,
*Kapitel*, *Das ganze Buch*, *Bis Kapitel n gelesen* (`trappist:web/app/copy/buddyRead.ts`).

---

### 3. Sharing mechanisms compared, and a recommendation

Precedents in the owner's repos, read, not assumed:

- **`@fabkho/ui`** (public, MIT): a git dependency pinned to an exact tag (`web/package.json:44`,
  `"@fabkho/ui": "github:fabkho/ui#v0.10.6"`; Trappist is on `v0.10.5`), release-please makes the tag, `ui-bump.yml` opens a weekly bump
  PR in each app (`.github/workflows/ui-bump.yml`, `docs/DEVELOPMENT.md` "The UI base bump"), the app reaches it as `#layers/ui`
  and `extends: uiLayer()` with `UI_LAYER=/path` as a local override (`web/ui.config.ts`). `web/AGENTS.md`: "pinned to a tag, never a branch".
- **Regal** (public now, `gh repo view fabkho/regal`): a Nuxt layer pulled by giget from the **default branch**, opt-in by
  `LIBELLUS_REGAL=1`, with `GIGET_AUTH` and `REGAL_LAYER=/path` (`web/regal.config.ts`). No version pin, a flag, a token path. The weaker
  precedent for a layer the app cannot build without.
- **foliate-js** vendored with a `VENDORED.md` (`web/app/reader/foliate-js/`): the old plan's model for a copy.

| | **A. Chat components into `@fabkho/ui`** | **B. `fabkho/chat`, a tag-pinned Nuxt layer (the `ui` way)** | **C. Monorepo** | **D. Vendor + sync script** | **E. Copy once** |
|---|---|---|---|---|---|
| What moves | presentational pieces only | layer today (1,136 lines + 1,348 tests) + Realtime core, photo, GIF client, error codes (about 2,000 lines + tests) | everything | the same as B, as files in both repos | the same as B, once |
| Already done? | **yes** (19 Oct, #298) | designed and guarded in Trappist, not split | no | no | no |
| Release cost | none new | one more repo: release-please, a vitest CI job (public repo: free minutes), a tag per release; `ui-bump.yml` generalised to two packages | one repo, one pipeline, huge move | none, but every sync is a manual PR | none |
| A change in one app reaches the other | a bump PR (weekly or by hand) | the same | immediately | when someone runs the script | never |
| CI and tests | story + axe in the base | plain-Node vitest travels with the package; the guard test moves with it | one big CI; Trappist's 3,000-minute private pool (`trappist:docs/CI.md`) vs Libellus' free public minutes | tests copied | tests copied |
| Risk of coupling the two release trains | low (UI is already coupled) | **low with exact pins**; a breaking `adapter.ts` change reaches an app only when it bumps. The layer imports `@fabkho/ui/pure/timeline` (one 5-line function, `compareCreated`): inline it or declare a peer range, or the two trains meet | **high**: Trappist is private, Libellus public; one deploy story for two products | medium: drift is silent | high over time |
| Effort in PRs | 0–2 (radio row, multi-reaction) | Trappist 2, new repo 1, Libellus 1 | many | 1, then one per sync | 1 |
| Verdict | **yes for anything presentational, no for logic** (the base's README says it is "props in, events out", and "no queue" until this work) | **recommended** | no | a fallback if B stalls | no (the old plan's choice, made when Trappist had 1:1 chat only) |

#### Variant B′: put the layer inside `fabkho/ui` as a second entry

It avoids a repo, but it breaks the base's identity ("presentational: no store, no data", `web/AGENTS.md` "Portable by default";
the base README's "Chat and the send queue" section keeps the queue out on purpose), ties the chat's releases to the
base's Storybook CI, and whether Nuxt resolves a sub-layer from `node_modules/@fabkho/ui/<dir>` as `#layers/chat` is **not verified**
here (it would take a 20-minute spike). Not recommended; B is a cleaner seam.

#### Recommendation

**Finish Trappist's own plan, with Libellus as the second consumer.** Concretely:

1. **Prep in Trappist (1 PR, normal tier).** Move into `web/layers/chat/`: `photo.ts`, `klipy.ts` (parametrised), a
   `liveChannel` extracted from `data/realtime.ts` and `stores/realtime.ts` (injected `loadRealtime`), the error-code list; move
   `inviteState.ts` out; decide the `chapterId` name; keep the guard test and extend it to the new files. Trappist's own app keeps
   working through re-exports at the old paths (the way `saveQueue.ts` does today).
2. **Split (1 small PR chain).** `git subtree split --prefix web/layers/chat` → public `fabkho/chat` (MIT, like `ui` and `regal`;
   the layer holds no secrets and, by its guard, no Trappist word), v0.1.0 by release-please, a vitest job, a README with the
   adapter contract. Trappist swaps its local folder for the tag-pinned dependency in one PR (alias `#layers/chat` stays, as
   `#layers/ui` does for a `node_modules` layer).
3. **Libellus adopts (1 PR before any feature).** `@fabkho/chat` pinned exactly, `extends`, the lazy Realtime door, a test that
   the entry chunk still holds no `realtime-js` (the build already fails if the entry imports a Regal chunk, `web/AGENTS.md`; the `realtime` chunk is named in
   `nuxt.config.ts`), `ui-bump.yml` generalised.
4. **Libellus builds its own side**: migrations (hand-ported, part 2c), its adapter implementation in `web/app/data/`, a
   small Pinia store on the layer's queue and thread, screens from the base. What its store and Trappist's store then both contain
   is the *next* extraction, 0.2.0, with a real second consumer's evidence.
5. **In parallel with 1–3:** Libellus' database work has no dependency on the package and can start the day the owner answers.
6. **Only then**, the features the old plan staged late (photos, push, saved chapter lists, ebook chapters), each its own PR.

**The split line.** Shared: the base's UI; the layer's queue, thread merge, veil, chapter arithmetic, adapter types, Realtime
mechanics, photo preparation, the GIF client, error codes. In each app: SQL, repositories, Pinia stores, pages and sheets,
copy, entry and invitation flow, reports and moderation, push, member identity, privacy text.

**What I would not share:** SQL (no generator, no extension); the 1,848-line chat store (extract its common core later, by
evidence); the group-chat product (admins, history windows, mute, group picture, hand-made groups, the Feed call), the book
card, the Orga; Trappist's push pipeline (Libellus' needs are a later, separate decision); `storageCache.ts` before photos exist;
a shared Supabase project (two audiences, two plans, two sets of rules).

**Biggest risks.**

- *The layer was designed for one consumer.* Shapes such as `inviteState`, a marker as an integer, `chapters_from` count/pages
  may be Trappist-isms. Mitigation: Libellus writes its adapter against 0.1.0 and anything it cannot express goes into 0.2.0,
  while both apps are still small consumers.
- *Trappist's chat is a moving target:* its `stores/chat.ts` was touched 17 times since 8 October. The layer's API may
  move weekly. Mitigation: exact pins, bump PRs reviewed like releases.
- *Visibility.* Trappist is private and Libellus is public. The package must be public; check the layer files for anything
  personal before the split (the guard bans domain words; it does not ban German strings or e-mail addresses).
- *Free plan.* Libellus' hosted Supabase is on **Free** (`docs/OPERATIONS.md`, "Backups"; Trappist is on Pro). Trappist measured
  7.0 GB of cached egress for 20–40 members on Free's 5 GB (`groups.md`, "What exists today", Storage row). Photos are the cost
  driver; the rest fits (part 5).
- *Progress leaves the database for the first time.* Social v1 promises "What never leaves … her progress"; a marker shown to co-members
  breaks it unless it is explicit and coarse (`web/app/legal/privacy.ts` and `docs/legal-checklist.md` change in the same PR).
- *Two spoiler models.* Choosing server gating later costs a stubbed reader RPC and a second code path; the veil hook
  (part 4) keeps that door open without paying for it now.

---

### 4. What buddy reads need that Trappist does not have, and the room the shared design must leave

| Need | Trappist today | Libellus needs | Room in the shared design |
|---|---|---|---|
| **Membership** | groups ≤ 30, admins, entry by Feed call (derived invitation, `join_buddy_group`) or by hand | a buddy read of ≤ 12 whose members are people she follows; **invitations, an invite link** `/t/<token>` (128 bits, copy of the follow link: `social_settings.follow_token`, `pages/f/[token].vue`, `utils/pendingFollow.ts`, `follow_target`), join, leave, host handover | `InviteAdapter.join/dismiss` (already a link-or-invitation contract); drop `inviteState` from the layer |
| **A Book** | a snapshot of title, author, cover, ISBN, no catalogue FK (`buddy_reads.book_*`) | `books.id` of a Catalogue Book (Manual books are private and cannot be shared, `CONTEXT.md`), her `library_entries` row, covers through `coverImage()` (own covers, `docs/covers.md`) | layer never sees a Book; `BuddyReadData.book` stays `{title, author, cover}` |
| **Sections and where they come from** | count or page ranges, renamable, insert a custom one (`set_buddy_chapters`, `add/rename/remove_buddy_chapter`; no Open Library: D18) | those, plus *her ebook's table of contents* (`web/app/reader/engine.ts` `TocItem {label, href, depth, fraction}`, line 32) and *a list saved by an earlier read of the same Book* (old plan §D, whose probes found no usable chapter data for German in-copyright books) | extend `ChapterPlan` with `from: 'list'` (explicit titles and pages), additive; `chapters.ts` stays arithmetic |
| **Spoiler anchors** | **none per message.** A hand-set marker opens threads up to chapter n; `spoiler` flags one message; the database gives every member every comment (`veil.ts` header) | the old plan wanted a server gate per message by anchor, from her automatic position | a **visibility hook** in the layer: `(record, viewer) → show | veil | hide`, default = Trappist's chapter rule; `ChatRecord` gains an optional `hidden` stub (no body, no media) that `UiBubble veiled` already draws. Server stubs become possible later without a layer change |
| **Her position** | she sets "Bis Kapitel n gelesen" by hand; "nothing here tracks reading" (`groups.md`, "Buddy reads") | automatic from her linked entry (`reading_sessions.progress_page` / `progress_percent`, the reader's `fraction`), with a hand override | the layer's `veil.ts` takes a marker *number*; where it comes from is the app's. `BuddyReadAdapter.setMarker` stays; an app-side trigger can write it |
| **Per-Section unread** | `buddy_read_cursors` per chapter; the pill counts across open chapters | the same | nothing to add; `mark_read(conv, up_to, chapter)` is the model |
| **Moderation** | admins (several) remove members; the **Orga** hides a message; members cannot delete or edit their own ("no editing or deleting in v1", `groups.md`, "Chapter threads") | the **host** removes members and may delete any message; members delete their own (old plan: tombstone, body and media cleared) | `ChatAction` gets `deleteOwn`, `deleteAny`; `UiReactionBar` `actions` already carries the entries |
| **Reports** | `report_chat_message` → `reports` → the Orga screen | the owner's inbox `public.feedback` (`20261024010000_feedback.sql`, `feedback_list`, `private.feedback_rate_limit()`) with a new kind `report` and the message and Section attached; no admin screen | `GroupAdapter`/`ChatAdapter` have no `report`; the app wires it to the bar's `actions` |
| **Reactions** | one of six emoji per member, written straight into the table under RLS | one per member (the base's bar) written through an RPC (Libellus has no table grants) | `react(messageId, emoji \| null)` is already one-per-member |
| **Blocks** | silent and symmetric inside a group (D6) | `private.blocked_either`, `reachable`, `visible` (`supabase/schema-snapshot/functions/private.*`); never invite across a block; a block never revealed | the filter lives in the SQL reader; nothing in the layer |
| **Account deletion, export, privacy** | `profiles_before_delete` anonymises; `export_my_data` lists her messages | `delete_my_account` already refuses with `photo_remains` while files remain; no export exists yet; `legal/privacy.ts` EN and DE, `docs/legal-checklist.md`, `docs/THIRD-PARTY.md` | none |
| **Push** | `chapter_reply` etc. through the general pipeline | Libellus' push is import-only (`push_subscriptions` migration `20261106010000`, `import-job/push.ts`, `public/sw-push.js` 63 lines, `stores/importPush.ts`); it has no events table, no kinds, no preferences | none; decide in Q18 |
| **Live transport** | one topic per member, whole row per recipient | the old plan: one topic per buddy read, a *nudge* (ids only), read through the RPC so one SQL gate serves every client | `ChatAdapter.live(on)` hides the topic shape. Q6 |

---

### 5. What changed in BetterReads since the old plan

Read at `78e974e4` (1 November 2026). The old plan said it was measured against `438b0d9f`, 12 October.

- **UI is the shared base.** The local copies are gone (`887a54ae`, #392, "the last local copies of the UI base go, on v0.6.0"),
  the app reaches it as `#layers/ui` (#389), pinned `v0.10.6`; a weekly bump PR (`.github/workflows/ui-bump.yml`). The base has
  the chat, `UiThreadRow`, `UiCheckList`, `UiImageCrop`. *Stale:* old §E "Trappist's UI layer is Libellus' design system
  (`docs/ui-layer-plan.md` there)" and every "copy `ChatMessage.vue` …" row.
- **Migrations are numbered `202611…`** and the latest is `20261112010000_hardcover_covers.sql` (100 files). Old plan:
  "the latest on main is `20261027010000_fill_book_covers.sql`", PR 1 `20261028010000`, PR 4 `20261028020000`. Renumber on top of `20261112…`.
- **`supabase/schema-snapshot/` and CI.** After a migration, `pnpm schema:snapshot` and commit it; CI fails on a stale
  snapshot; `release.yml` warns about drift (`AGENTS.md`). A pull request that edits or deletes an applied migration fails CI.
  New for any DB PR, not in the old plan.
- **Web Push exists, for the import only**: `supabase/migrations/20261106010000_push_subscriptions.sql`,
  `supabase/functions/import-job/push.ts` (+ `webpush.ts`), `web/public/sw-push.js`, `web/app/data/pushSubscription.ts` (181),
  `web/app/stores/importPush.ts` (#398). *Stale:* old §A "No push and no in-app notifications" (the lamp dot is still the only in-app indicator).
  The old plan's option C "web push" is no longer from zero, but there are no kinds, events or preferences.
- **Realtime has a door.** `web/app/data/importJobFeed.ts` (115 lines) loads the real client lazily as `#realtime-client`
  (`web/realtime.config.ts`), in its own `realtime` chunk that is not precached (`nuxt.config.ts`); `AGENTS.md` makes it the rule for any new use.
  *Stale:* old §C "lazy-imports the real `RealtimeClient` by its file path (a regex alias …; to prove in PR 5)" and the old measured 17.2 KB gzip stands as the lazy chunk's size.
- **Own covers** (`20261108010000_cover_store.sql`, `…cover_read_path`, `…cover_gc`, `supabase/functions/cover-store/`, `/c/<key>/<width>`
  via R2, `coverImage()` in the UI; off by default, `NUXT_PUBLIC_OWN_COVERS`): a buddy read's cover must be drawn through
  the same helpers; still **one Supabase Storage bucket** (`avatars`, `20261009120000_avatars.sql`), so the old claim holds and
  covers did not add a bucket.
- **App-update sheet** (`e68b43f4`, #354; `web/app/stores/appUpdate.ts`): "a new release is offered, never swapped in under
  the page". An open thread can therefore talk to a newer database than its bundle: RPC changes must be additive.
- **Sentry** (#440, `805f6887`; `web/app/utils/sentry*.ts`): "anything new that can reach an event goes through `scrubEvent`".
  A message body must never reach an event; the old plan's "watch `client_errors` for `/together/*`" is now partly Sentry.
- **Social v2a, follows, blocks, `feedback`**: all pre-date the old plan and are unchanged (`20261017…` to `20261025010000_social_v2a.sql`,
  `20261024010000_feedback.sql`, `20261025040000_book_readers.sql`); the old plan's §A on them is still right.
- **The reader, i18n, outbox**: foliate reader and `TocItem` (`web/app/reader/engine.ts:32`) unchanged; i18n EN/DE is a key file
  pair of 2,226 lines each with `pnpm i18n:translate` and a parity test (the old plan wrote German drafts by hand);
  the outbox (`web/app/data/outbox.ts`, 395 lines, IndexedDB, `sync_write`) is a *library* outbox and stays separate from the chat queue.
- **Hosting and visibility.** Libellus' repo is public (`gh repo view fabkho/libellus`), as are `fabkho/ui` and `fabkho/regal`;
  Trappist is private. Supabase: **Free** (`docs/OPERATIONS.md`, "Backups"); Trappist moved to Pro.
- **Docs rules** (`AGENTS.md`): README holds no setup; operations go in `docs/OPERATIONS.md`, `HOSTING.md`, `SETUP.md`,
  `THIRD-PARTY.md`; plans in `docs/plans/`; each screen a `docs/parity.md` entry.
- Not related, and ignored: import server job, Hardcover, new logo and launch takeover, the chart.

#### Statements in the old plan that are now stale

| Old plan | Now |
|---|---|
| Intro and §E: "Trappist's chat is strictly 1:1", "The data model must be new" | groups, buddy reads, chapter threads, markers exist (G0–G12) |
| §E: copy `ChatMessage.vue`, `ChatComposer.vue`, `ChatReactionBar.vue`, `ChatGifPicker.vue`, `ChatMediaViewer.vue`, `timeline.ts` | deleted 19 Oct (#298); they are `UiBubble`, `UiComposer`, `UiReactionBar`, `UiGifPicker`, `UiMediaViewer`, `@fabkho/ui/pure/timeline` in `@fabkho/ui` |
| §E: "`supabase/functions/gifs/index.ts`, `giphy.ts`, GIPHY search behind the server" | deleted 8 Oct (#120); the audit read Trappist at `0f3c2af`, the same day, just before. KLIPY, straight from the phone, never copied or proxied |
| §E: `stores/chat.ts` "1094 lines", "far too coupled" | 1,848 lines; the queue it carried is now `layers/chat` |
| §E: "Copy with a `VENDORED.md`, not a shared package now" | Trappist's plan (`groups.md` D25, "Port to BetterReads") prepared the split instead |
| §E: "a send queue … not now … chat is online-only in v1" | the queue is a tested, framework-free layer module; online-only is no longer the cheap option |
| §E: reactions "key `(message, member, emoji)` to allow several" | the base's `UiReactionBar` is one per member; several needs a base change |
| §A/§C: "No push", Realtime stub "to prove in PR 5" | import push exists; the `#realtime-client` door exists |
| §C migration names `20261028…` | `20261113…` or later |
| §D: chapters from saved, ebook, Open Library, pages | Trappist chose count/pages only (D18) after reading this plan's probes; the ebook source is Libellus-only |
| §F/§G: GIPHY, proxy through a Pages function, "Trappist copies instead" | KLIPY terms forbid copy and proxy; open question 5 is answered |
| §H: PR 4 "components/together/Thread*.vue (from Trappist's chat components)" and PR 5/6/7 "from Trappist …" | the components are in the base; the client pieces come from the package |
| §G: "mid-Section, she sees what slower readers wrote, never what faster ones wrote" (a per-message SQL anchor) | not what Trappist built; Q8 |

---

### 6. Questions for the owner

Each has my recommendation; "yes" to all of them is a coherent plan. Questions the old plan asked that Trappist's choices
have answered are listed first and are not asked again.

**Old questions already answered, no action:**

| Old Q | Answer, from where |
|---|---|
| Q2 may co-members see each other's Section | **Yes, coarse:** Trappist D19 shows a face on the chapter row, never a page (`groups.md`). Adopted; the privacy text says so. |
| Q5 GIPHY or KLIPY, proxy or copy | **KLIPY, direct from the phone, never copied or proxied** (`trappist:web/app/data/klipy.ts`). Only Q14 below remains (a key for Libellus). |
| Q10 shared saved chapter lists | **Deferred by Trappist** ("later: one query, worth it once a book comes round twice"). Kept as a follow-up in Q10. |
| Q4 (editing within 15 minutes) | Trappist has neither edit nor member delete in v1. Q12 asks only about delete. |

#### A. Sharing

1. **Mechanism.** Finish Trappist's planned extraction: `web/layers/chat` becomes a tag-pinned git dependency `@fabkho/chat`
   (the `@fabkho/ui` way), Libellus is the second consumer. Not a monorepo, not a copy.
   *Recommend yes:* ~2,000 lines of tested logic and every Realtime and photo fix Trappist paid for come with it;
   a copy would be the third copy of a queue (Libellus' outbox, Trappist's, this one).
2. **Home and visibility.** A new **public** repo `fabkho/chat` (MIT, like `ui` and `regal`), not a second entry inside `fabkho/ui`.
   *Recommend yes:* Libellus' CI must install it without a token (the `ui` model); the base keeps "presentational only".
3. **First cut and naming.** Into the first release: queue, thread, veil, chapters, adapter types, the Realtime core, photo
   preparation, the GIF client, the error-code list; `inviteState` stays in Trappist; rename `chapterId` to a neutral
   `threadId` before 0.1.0.
   *Recommend yes:* a rename after two consumers exist is a breaking release; today it is a find-and-replace.
4. **SQL.** Hand-ported by a worker from Trappist's snapshot and pgTAP, with the behaviour checklist (part 1.2) in the PR and a
   header naming the Trappist commit; no generator, no extension, no shared SQL package.
   *Recommend yes.*
5. **Who may touch Trappist, and in what order.** The prep PR (steps 1 and 2 of the recommendation) edits Trappist, which is
   read-only for this plan. May a worker do that on your go, with Libellus' database work starting in parallel?
   *Recommend yes*, with the Libellus UI work waiting for `@fabkho/chat` 0.1.0.
6. **Live transport.** One private topic **per member** like Trappist (`member:<id>`, the whole row to each recipient, 12 messages per post),
   or the old plan's one topic **per buddy read** with an ids-only nudge?
   *Recommend per member:* the layer's resync and cold-start code, and Trappist's `realtime_test.sql`, are written for it; a
   post to 11 others is about 12 Realtime messages, so 1,000 posts a month cost 12 k of Free's 2 M (the old plan's own arithmetic, §G);
   the nudge saves messages Libellus does not need to save, and it needs a second read RPC per event.

#### B. Product model

7. **One room or a group product.** A Libellus buddy read is **one Book and one room** (the room's "Before we start" thread is the
   conversation itself, each Section a `chapter` thread), 2–12 members, no groups by hand, no group list, one read per room. The
   tables mirror Trappist's (conversation, membership, messages with a thread id) so the port is mechanical.
   *Recommend yes:* the smaller product Libellus asked for, on the shape Trappist proved.
8. **Spoiler gate (the old plan's per-message SQL anchor vs Trappist's veil).** v1 uses **Trappist's veil**: the database returns the
   Section's messages to members, the client veils Sections ahead of her marker (`veil.ts`, `UiBubble veiled`, `UiThreadRow`), a
   per-message "spoiler" flag exists, the hook for a server stub is left in the layer.
   *Recommend yes:* it is already written and tested; "spoilers here are a courtesy among friends" (old plan §C said the same);
   the stub can come later without a layer change. The price: a determined member reading the API sees everything.
9. **Her position.** Automatic from the progress of her linked entry (page, percent, ebook `fraction`) turned into a Section
   number, with a hand override ("I'm at…") for members without a linked entry; shown to co-members as **the Section only**.
   *Recommend yes:* it is the reason to build this in Libellus rather than add it to Trappist's hand-set marker;
   `veil.ts` needs only the number. It needs the privacy text (progress leaves the database for the first time).
10. **Where Sections come from in v1.** Count or pages (Trappist's, shared), host-editable, "Before we start" and "The whole book" always.
    The ebook table of contents and the crowd-saved list (old Q10) follow as separate PRs.
    *Recommend yes:* the old plan's own probes found no chapter data for German in-copyright books, so count/pages is the common case.
11. **Who invites, who holds the link, how many.** The **host** invites (people she follows, not blocked either way) and holds the
    link; the link is for **members only** (the app is invite-only; a stranger is sent to the waitlist); cap **12**.
    *Recommend yes:* smaller moderation surface (Trappist D3/D21: admins only add and manage), simpler than the old plan's
    "every member may invite", and it answers the old Q1 and Q3 and the member half of Q4.
12. **Deleting messages.** A member deletes her own and the host deletes any (a tombstone: body and media cleared, "Message
    removed"); no editing.
    *Recommend yes:* Trappist has neither, but a host who cannot remove a message has only the report inbox, and the
    base's `actions` slot already carries the entry.
13. **Look and reactions.** Use the base's bubbles (`UiBubble`) and **one reaction per member** (`UiReactionBar`), not the old mock's
    hairline rows and several emoji.
    *Recommend yes:* the base rule is "nothing of the app replaces it"; rows would need a new base component; several emoji
    would need a base change.
14. **GIFs.** Yes, KLIPY direct from the phone, with a **new app key for Libellus** in KLIPY's Partner Panel, the "Powered by KLIPY"
    mark, `docs/THIRD-PARTY.md`, the privacy text and the CSP entries.
    *Recommend yes, after the first release*, not in the first PR.
15. **Photos.** Not in v1; GIFs, text, replies and reactions only.
    *Recommend no photos yet:* Libellus is on Free; Trappist measured 7.0 GB of egress for 20–40 members on Free's 5 GB and
    moved to Pro (`groups.md`). If you want photos: Pro first, or a monthly cap per member (the old plan's 30) and 1280 px.
16. **Retention.** Keep an ended read readable until its last member leaves or deletes her account (the read is then deleted with
    its messages), with no timed deletion.
    *Recommend yes:* that is Trappist's behaviour (archived = read-only, kept); the old plan's 12-month job is a cron and an Edge
    Function for little gain at this size.
17. **Name and entry.** "Buddy read" (English) and "Buddy-Read" (German), as Trappist's German already says; the entry is a *Read together*
    row on the Book page and a Home card; the first release sits behind a Profile → Account switch like the Friends tab, then on.
    *Recommend yes.*
18. **Notifications.** In-app only in v1 (the lamp dot, a Home card, unread counts per Section). No e-mail digest. Push for
    "someone answered you" (Trappist's `chapter_reply`) is its own PR later, on top of a general events table that Libellus does
    not have yet.
    *Recommend yes.*
19. **Reports and blocks.** A message report goes to the owner's `feedback` inbox as a new kind with the message and Section
    attached (no admin screen); blocks follow Trappist's D6: nobody is removed, the two stop seeing each other's messages and
    reactions, and nobody can be invited across a block.
    *Recommend yes.*
20. **Offline sending.** Use the layer's queue (optimistic send by `clientId`, retry with back-off, order kept) instead of the
    old plan's "online-only in v1"; Libellus' library outbox is untouched.
    *Recommend yes:* it is built and tested, and a message typed on a train should not vanish.

---

### What this document is not

It is not the build plan. After the answers, a second turn writes the work packages (order, tiers, files, tests, the
`docs/parity.md` and privacy entries, the `CONTEXT.md` words). Nothing here changes `README.md`, the migrations, Trappist,
`@fabkho/ui` or Regal.
