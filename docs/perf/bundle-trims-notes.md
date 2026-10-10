# Bundle trims: notes for the resume (F6)

Branch `perf/bundle-trims`. F4, F1 and F2 are done and measured (docs/perf/bundle.md, section 7). F6 is paused.

## State

`docs/perf/data/bundle/f6-wip.patch` (apply from the repo root: `git apply docs/perf/data/bundle/f6-wip.patch`;
`git apply -R` removes it) holds the whole working F6 change, tested only by `reader.spec.ts` and `ebooks.spec.ts`:

- `nuxt.config.ts`: `codeSplitting` group `ebook-reader` (`isReaderModule`: `app/reader/`, `app/components/reader/`,
  dompurify, the `@fontsource/*/files/*?url` assets), `chunkFileNames` naming the two dynamic entries
  (`Reader.vue`, `engine.ts`) `ebook-reader-entry.[hash].js`, `globIgnores` `**/ebook-reader*.{js,css}`, a
  CacheFirst rule `libellus-reader` (6 entries).
- `app/data/reader/prefetch.ts` (pure: `mayPrefetch`, `hasOpenableEbook`, `createReaderPrefetch`),
  `app/utils/readerChunks.ts` (the two `import()`s, once), `app/plugins/reader-prefetch.client.ts` (3 s after mount,
  on idle, when the ebooks snapshot in localStorage has a linked, not missing record), `pages/book/[key].vue`
  (idle prefetch when the entry has its ebook).
- `perf/reader.ts` + `pnpm perf:reader`: the measurement still to run (cases: network prefetched, mid-prefetch, cold;
  sw returning member). First run failed in setup (the `home.reading` card was not found: the seeded library has
  no "reading" entry on Home in that stack, pick a Book another way, e.g. `/library` then the first card).

## Findings that cost time

- The group must not contain the dynamically imported modules themselves: with `Reader.vue`/`engine.ts` in the
  group the bundler emits a facade chunk with `export { engine_exports }` and no declaration
  (`SyntaxError: Export 'engine_exports' is not defined in module`; the reader never opens).
- A group named `reader` collides with the chunk the bundler names from `stores/reader.ts`; use `ebook-reader`.
- Reader-only code is ~264 KB raw / ~83 KB br, not ~200 KB br.
- `web/perf/` is gitignored: new files there need `git add -f`.

## Left to do

1. Fix `perf/reader.ts` setup, run it at `slow4g-4x` against `origin/main` and the patch (`--label before/after`).
   The prefetched path must show no loading UI; say plainly what the cold tap shows (a dead tap until the chunks
   arrive: there is no loader in `Reader.vue`); if too slow, prefetch earlier (drop the 3 s delay).
2. Vitest for the prefetch conditions (`mayPrefetch`, `hasOpenableEbook`, `createReaderPrefetch`: once, retry after a
   failure, nothing offline/save-data).
3. Offline check: an opened book opens offline (CacheFirst), a never-opened reader offline is the accepted regression.
4. docs/parity.md (the precache line, the reader section), web/AGENTS.md; commit as `perf(web): ...`.
5. Stack for measuring: copy `supabase/` to `/tmp`, ports 5570x (`perl -pi -e 's/5532(\d)/5570$1/'`), own project id;
   `PERF_STACK_PORT=55701 PERF_STACK_DIR=...`; e2e needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`,
   `MAILPIT_URL`, `LIBELLUS_E2E_PORT`.
