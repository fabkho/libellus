#!/usr/bin/env node
// Assembles the source maps the release job "source maps to Sentry" uploads (release.yml; docs/OPERATIONS.md,
// "Sentry"). Reads the build in `web/dist/_nuxt` (the job's own `pnpm generate`) and writes, into the directory
// given as the first argument, one `.js` and one `.js.map` per chunk **under the name the served site uses for it**.
//
// Why it is needed: Cloudflare Pages builds the live site itself, and a second build of the same commit does not
// reproduce its chunk names. What was measured: the same sources built twice here agree with each other and with the
// live names (so it is not the toolchain), but a build that reuses a warm `node_modules/.cache/nuxt` emits a
// different set — and `@nuxtjs/i18n` keys a locale's loader chunk by the hash of the locale file's *absolute* path
// (`/opt/buildhome/repo/` on Pages, `/home/runner/work/…` here), which no build off Pages can reproduce and which
// renames every chunk naming it. Sentry matches an uploaded map to a reported frame by release + file name alone
// (`~/_nuxt/<file name>`), so maps uploaded under the locally built names are never found and every stack trace
// stays minified — which is exactly what the events showed.
//
// So the names are not derived, they are looked up: the served chunks are fetched from the live origin and paired
// with the local ones by content. A chunk whose bytes are identical pairs directly; one whose bytes differ only in
// the chunk names it imports (or in that locale key) pairs as soon as those names are known. That is a fixpoint
// over a handful of rounds. The pairing is also what says the deployment being read is this release's build, so a
// re-run against an already-published tag works without waiting for a build that will not happen.
//
// Exits non-zero when the live site cannot be read within the deadline, or when too few chunks pair: a map under
// the wrong name is worse than no map, so the job then uploads nothing (it is `continue-on-error`, so this never
// fails a release).
//
// What the pairing needs (measured against v1.51.2, 2026-11): the job's own build must reproduce Pages' bytes, and
// `runtimeConfig.public` is inlined into the chunks that read it — so one missing `NUXT_PUBLIC_*` changes every
// chunk that names it. Built with the job's old environment: 51 of 211 served chunks paired (24 %). Built with
// Pages' public config: 211 of 211 (100 %). Regal is part of it too, and it must be the *same copy*: the layer's
// path decides the `data-v-*` scope id of its scoped styles, so a checkout pairs worse than the downloaded one.
// Hence the required build inputs are asserted below before anything is fetched, and a poll whose pairing stops
// improving while still under MIN_AGREEMENT ends the job right there, not at the deadline.
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository root, so the script works from any working directory. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ORIGIN = process.env.SENTRY_SOURCEMAPS_ORIGIN ?? 'https://betterreads.de'
const OUT = process.argv[2] ?? join(ROOT, 'web/sentry-maps')
const DIST = join(ROOT, 'web/dist/_nuxt')
/** How long to wait for Pages to publish the deployment this build is for (Pages takes one to two minutes). */
const WAIT_MS = Number(process.env.SENTRY_SOURCEMAPS_WAIT_MS ?? 5 * 60 * 1000)
const POLL_MS = Number(process.env.SENTRY_SOURCEMAPS_POLL_MS ?? 20 * 1000)
/** Below this share of paired served chunks, the served build is not this one. */
const MIN_AGREEMENT = Number(process.env.SENTRY_SOURCEMAPS_MIN_AGREEMENT ?? 0.9)
/** Consecutive polls with no gain under MIN_AGREEMENT before the pairing is called a mismatch. */
const PLATEAU_POLLS = Number(process.env.SENTRY_SOURCEMAPS_PLATEAU_POLLS ?? 3)
/**
 * What the build this script reads must have been given, or its bytes cannot be the served ones. The `NUXT_PUBLIC_*`
 * ones are the ones the live site is built with (docs/HOSTING.md, the Pages table; docs/OPERATIONS.md, "Source
 * maps"): they are inlined, so a build without one differs from the served build in every chunk naming it.
 */
const REQUIRED_BUILD_ENV = [
  ['LIBELLUS_REGAL', 'without it the shelf is not built and Regal\'s chunks are missing'],
  ['GIGET_AUTH', 'without it the Regal layer cannot be fetched'],
  ['NUXT_PUBLIC_REGAL_LIBRARY_SRC', 'the shelf\'s library file, inlined into the shelf\'s chunks'],
  ['NUXT_PUBLIC_SUPABASE_URL', 'inlined into the Supabase client, the entry and the page head'],
  ['NUXT_PUBLIC_SUPABASE_ANON_KEY', 'inlined next to the URL, in the same chunks'],
  ['NUXT_PUBLIC_SHELF_OWNER_ID', 'inlined into the shelf\'s stores and screens'],
  ['NUXT_PUBLIC_SENTRY_DSN', 'inlined into the Sentry chunk: without it Sentry is off and that chunk differs'],
]

const log = (msg) => console.log(`[sourcemaps] ${msg}`)
const die = (msg) => {
  console.error(`[sourcemaps] ${msg}`)
  process.exit(1)
}

const fetchText = async (path) => {
  try {
    const res = await fetch(new URL(path, ORIGIN), { signal: AbortSignal.timeout(30_000) })
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

/** `/...` URLs of every `_nuxt` chunk the served site loads, following the chunks' own imports. */
async function crawl() {
  const seen = new Set()
  const queue = []
  const html = await fetchText('/')
  if (html === null) return null
  for (const m of html.matchAll(/(?:src|href)="(\/_nuxt\/[A-Za-z0-9_.-]+\.js)"/g)) queue.push(m[1])
  while (queue.length) {
    const path = queue.pop()
    if (seen.has(path)) continue
    seen.add(path)
    const body = await fetchText(path)
    if (body === null) continue
    // A chunk names its own imports relative to itself (`./X.js`, in `__vite__mapDeps` and in its `import`s):
    // together they reach every chunk a page can load, including the lazy ones (`regal-reel`, `sentry`).
    for (const m of body.matchAll(/\.\/([A-Za-z0-9_.-]+\.js)/g)) queue.push(`/_nuxt/${m[1]}`)
  }
  return [...seen]
}

const chunkName = (path) => path.split('/').pop()

/** Pairs `served` (name -> body) with `local`: returns a map of local name -> served name. */
function pair(local, served) {
  const renames = new Map()
  const byContent = new Map([...local].map(([name, body]) => [body, name]))
  for (const [name, body] of served) {
    const match = byContent.get(body)
    if (match !== undefined && !renames.has(match)) renames.set(match, name)
  }

  // `@nuxtjs/i18n` keys a locale's loader chunk by the hash of its *absolute* path, so the same app emits a
  // different key on Pages and here, renaming every chunk that names it. That key carries no meaning for the
  // map, so it is normalised away for the pairing alone (the uploaded map is the local one, whose key matches
  // its own chunk set).
  const localeKey = /_46json_[a-f0-9]{8}/g
  const normalize = (body) => body.replace(localeKey, '_46json_HASH____')
  const imports = /\.\/([A-Za-z0-9_.-]+\.js)/g
  const localJs = [...local].filter(([name]) => name.endsWith('.js'))

  for (let round = 1; round <= 20; round += 1) {
    const before = renames.size
    const servedToLocal = new Map([...renames].map(([l, s]) => [s, l]))
    for (const [servedName, servedBody] of served) {
      if (renames.has(servedName)) continue
      // Rewrite the imports of a served chunk into local names wherever they are known; a local chunk that then
      // equals it is the same chunk under another name (only the names it imports were different).
      const rewritten = normalize(servedBody).replace(imports, (all, imported) => {
        const localName = servedToLocal.get(imported)
        return localName === undefined ? all : `./${localName}`
      })
      for (const [localName, localBody] of localJs) {
        if (renames.has(localName) || normalize(localBody) !== rewritten) continue
        renames.set(localName, servedName)
        break
      }
    }
    if (renames.size === before) break
  }
  return renames
}

/**
 * The build and the served site do not agree: say how far off it is, which variables it was built with, and exit 1
 * now rather than waiting out the deadline. `best` is the best pairing any poll reached.
 *
 * The environment is listed because that is what moves these bytes without touching a line of source: the public
 * config is inlined, and Regal's copy decides its scope ids.
 */
function serveMismatch(best) {
  const share = best.of > 0 ? `${best.paired} of ${best.of} served chunks paired (${(best.agreement * 100).toFixed(0)} %)` : 'no served chunk was read'
  const missing = REQUIRED_BUILD_ENV.filter(([name]) => !process.env[name]?.trim())
  die(
    `the served build differs from this one (${share}), so no map can be named after it and nothing is uploaded.\n` +
      'The public config is inlined into the chunks, so a build without it differs in every chunk naming it:\n' +
      REQUIRED_BUILD_ENV.map(
        ([name]) => `  ${name}: ${process.env[name]?.trim() ? 'set' : 'NOT SET'}`,
      ).join('\n') +
      (missing.length > 0
        ? `\nSet the missing ones from the GitHub Environment \`production\` (docs/OPERATIONS.md, "Source maps").`
        : '\nAll of them are set, so the difference is elsewhere: a different copy of the Regal layer (its path decides\n' +
          'the scope ids of its styles, so `GIGET_AUTH` and not `REGAL_LAYER`), a different install (the lock file), or\n' +
          'the live site still serving another release.') +
      '\nA map under the wrong name is worse than none (docs/OPERATIONS.md, "Source maps").',
  )
}

async function main() {
  // The build this reads has to be Pages' build, and Pages' build is its environment (docs/OPERATIONS.md, "Source
  // maps"): a missing `NUXT_PUBLIC_*` is inlined as a different value, or as nothing, into every chunk naming it, and
  // no fixpoint over import names recovers that. Say which one before spending minutes fetching the served chunks.
  const unset = REQUIRED_BUILD_ENV.filter(([name]) => !process.env[name]?.trim())
  if (unset.length > 0) {
    die(
      'this build is missing the public config Pages builds with, so it cannot pair with the served chunks\n' +
        `(nothing is uploaded). Unset: ${unset.map(([name]) => name).join(', ')}.\n` +
        unset.map(([name, why]) => `  ${name}: ${why}.`).join('\n') +
        '\nThey come from the GitHub Environment `production` (docs/OPERATIONS.md, "Source maps"), never from a .env.',
    )
  }
  if (!existsSync(DIST)) die(`${DIST} is missing: run \`pnpm generate\` first.`)

  const local = new Map()
  for (const file of await readdir(DIST)) {
    if (!file.endsWith('.js') && !file.endsWith('.map')) continue
    const path = join(DIST, file)
    if (!(await stat(path)).isFile()) continue
    local.set(file, await readFile(path, 'utf8'))
  }
  const localJs = [...local].filter(([name]) => name.endsWith('.js')).length
  if (localJs === 0) die(`no chunks in ${DIST}.`)

  const deadline = Number(process.env.SENTRY_SOURCEMAPS_DEADLINE ?? Date.now() + WAIT_MS)
  let renames = null
  let served = null
  let last = null
  // The best pairing seen so far: what the mismatch report names when the wait ends, and what the plateau counts.
  let best = { paired: 0, of: 0, agreement: 0 }
  let plateaus = 0
  while (Date.now() < deadline) {
    const paths = await crawl()
    if (paths !== null) {
      const now = new Map()
      for (const path of paths) now.set(chunkName(path), await fetchText(path))
      for (const [name, body] of now) if (body === null) now.delete(name)
      // Pages publishes a deployment's files before its `index.html`: for a moment a crawl sees both builds.
      const fingerprint = [...now.keys()].sort().join('\n')
      if (now.size > 0 && fingerprint === last) {
        const found = pair(local, now)
        const agreement = found.size / now.size
        log(`${now.size} served chunks, ${found.size} paired (${(agreement * 100).toFixed(0)} %)`)
        if (agreement >= MIN_AGREEMENT) {
          renames = found
          served = now
          break
        }
        // Below MIN_AGREEMENT: a deployment Pages is still publishing changes from poll to poll. One that repeats
        // the same pairing is not going to become this build by waiting — every further poll sees the same bytes.
        if (found.size > best.paired) {
          best = { paired: found.size, of: now.size, agreement }
          plateaus = 0
        } else {
          plateaus += 1
          log(`no gain since the last poll (${plateaus}/${PLATEAU_POLLS})`)
          if (plateaus >= PLATEAU_POLLS) {
            serveMismatch(best)
          }
        }
      }
      last = fingerprint
    }
    log(`waiting for Pages to publish this release (${Math.round((deadline - Date.now()) / 1000)} s left)`)
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  if (renames === null) {
    serveMismatch(best)
  }

  // Assemble the upload directory: the served name for every chunk that paired. `sentry-cli sourcemaps upload
  // --url-prefix '~/_nuxt'` turns each file into the artifact `~/_nuxt/<file name>`, which is exactly how a frame
  // reported from the served chunk is looked up.
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })
  let maps = 0
  for (const [localName, servedName] of [...renames].sort()) {
    if (!localName.endsWith('.js')) continue
    await copyFile(join(DIST, localName), join(OUT, servedName))
    const map = local.get(`${localName}.map`)
    if (map === undefined) continue
    // A map names its own file; it must name the served chunk, or the CLI uploads it under the name it carries.
    await writeFile(join(OUT, `${servedName}.map`), map.replace(/"file":\s*"[^"]*"/, `"file":"${servedName}"`))
    maps += 1
  }
  const renamed = [...renames].filter(([l, s]) => l !== s).length
  log(`${maps} maps in ${OUT} (${renamed} of ${renames.size} chunks renamed to the served name)`)
  const missing = [...served.keys()].filter((name) => ![...renames.values()].includes(name))
  if (missing.length > 0) log(`served without a map: ${missing.join(', ')}`)
}

await main()
