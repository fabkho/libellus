/**
 * The Fable import (issue #17): the owner's whole Fable history into one
 * member's Library, once, idempotently. Also the dev seed (`pnpm seed:dev`).
 *
 *   pnpm import:fable --email <member> [options]
 *   pnpm seed:dev                       # into dev@libellus.local on the local stack
 *
 * Options:
 *   --email <address>     the member to import into (must exist)
 *   --from <file.json>    `reading list --json` output; default: run the
 *                         reading-tracker CLI ($READING_TRACKER_CLI, else
 *                         ~/code/reading-tracker-cli/dist/index.js)
 *   --overrides <file>    corrections; default $REGAL_OVERRIDES, else
 *                         ~/.reading-tracker/regal-overrides.json when present
 *   --target local|hosted local (default): the stack `supabase status` reports.
 *                         hosted (#18): $SUPABASE_URL + $SUPABASE_SERVICE_ROLE_KEY,
 *                         and --confirm-host <host> must name the URL's host
 *   --dry-run             read the target, write nothing, print what would change
 *   --plan                map only: no target, no cover lookups
 *   --prune               delete imported entries whose record the plan no longer has
 *   --offline             no cover lookups: only what .data/ already knows
 *   --refresh-covers      look every Book up again, ignoring .data/
 *
 * The pipeline: read the records → apply the overrides and map them
 * (app/data/import/, pure, tested) → look up covers and Catalogue ids
 * (scripts/fable/covers.ts, cached in .data/fable-import/) → write as the
 * service role (scripts/fable/write.ts). Real data stays out of git: the
 * cache and the report live in the repo's `.data/`, which is ignored.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { mapFableLibrary, summarizePlan, type ImportEntry } from '../app/data/import/fable'
import { parseReadingTracker, type Overrides } from '../app/data/import/readingTracker'
import { lookupEdition, lookupKey, withLookup, type EditionLookup } from './fable/covers'
import { LookupCache, nodeLookupDeps } from './fable/node'
import { findMemberId, writeImport } from './fable/write'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const dataDir = join(repoRoot, '.data', 'fable-import')
const expandHome = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const { values: args } = parseArgs({
  options: {
    'email': { type: 'string' },
    'from': { type: 'string' },
    'overrides': { type: 'string' },
    'target': { type: 'string', default: process.env.LIBELLUS_IMPORT_TARGET ?? 'local' },
    'confirm-host': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'plan': { type: 'boolean', default: false },
    'prune': { type: 'boolean', default: false },
    'offline': { type: 'boolean', default: false },
    'refresh-covers': { type: 'boolean', default: false },
    'help': { type: 'boolean', short: 'h', default: false },
  },
})

function fail(message: string): never {
  console.error(`import-fable: ${message}`)
  process.exit(1)
}

if (args.help) {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  console.log(source.slice(source.indexOf('/**') + 3, source.indexOf('*/')).replace(/^ \* ?/gm, ''))
  process.exit(0)
}

// ------------------------------------------------------------------ the input

function readRecords(): string {
  if (args.from) return readFileSync(resolve(expandHome(args.from)), 'utf8')
  const cli = expandHome(process.env.READING_TRACKER_CLI ?? '~/code/reading-tracker-cli/dist/index.js')
  if (!existsSync(cli)) fail(`no --from file and no reading-tracker CLI at ${cli} (set READING_TRACKER_CLI)`)
  return execFileSync(process.execPath, [cli, 'list', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function readOverrides(): { overrides: Overrides; path: string | null } {
  const explicit = args.overrides ?? process.env.REGAL_OVERRIDES
  const path = resolve(expandHome(explicit ?? '~/.reading-tracker/regal-overrides.json'))
  if (!existsSync(path)) {
    if (explicit) fail(`overrides file not found: ${path}`)
    return { overrides: {}, path: null }
  }
  return { overrides: JSON.parse(readFileSync(path, 'utf8')) as Overrides, path }
}

// ----------------------------------------------------------------- the target

function target(): { url: string; serviceKey: string; label: string } {
  if (args.target === 'local') {
    // Always the stack this checkout runs, whatever SUPABASE_URL says: an
    // exported hosted URL must never turn a dev seed into a production write.
    let env: string
    try {
      env = execFileSync('supabase', ['status', '-o', 'env'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      fail('no local stack answering: run `supabase start` in the repo root')
    }
    const value = (name: string) => env.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm'))?.[1]
    const url = value('API_URL')
    const serviceKey = value('SERVICE_ROLE_KEY')
    if (!url || !serviceKey) fail('`supabase status` reported no API_URL or SERVICE_ROLE_KEY')
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) fail(`the local stack's URL is not local: ${url}`)
    return { url, serviceKey, label: `local ${url}` }
  }
  if (args.target === 'hosted') {
    const url = process.env.SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) fail('--target hosted needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY exported')
    const host = new URL(url).host
    if (args['confirm-host'] !== host) fail(`--target hosted writes to ${host}; repeat it with --confirm-host ${host}`)
    return { url, serviceKey, label: `hosted ${host}` }
  }
  fail(`unknown --target "${args.target}" (local or hosted)`)
}

// ------------------------------------------------------------------- the run

async function lookUp(entries: ImportEntry[]): Promise<{ entries: ImportEntry[]; lookups: (EditionLookup | null)[]; failed: string[] }> {
  const cache = new LookupCache(join(dataDir, 'lookups.json'))
  const deps = nodeLookupDeps((line) => console.log(line))
  const lookups: (EditionLookup | null)[] = new Array(entries.length).fill(null)
  const failed: string[] = []
  let asked = 0
  // A few at a time; Apple's requests queue behind each other anyway (node.ts).
  let next = 0
  const worker = async () => {
    while (next < entries.length) {
      const index = next++
      const entry = entries[index]!
      const key = lookupKey(entry)
      const cached = args['refresh-covers'] ? undefined : cache.get(key)
      if (cached || args.offline) {
        lookups[index] = cached ?? null
        continue
      }
      try {
        const found = await lookupEdition(entry, deps)
        cache.set(key, found)
        lookups[index] = found
        asked++
        console.log(`  cover ${String(asked).padStart(3)} ${entry.book.title}: ${found.cover?.source ?? 'none'}${found.cover ? ` ${found.cover.width}×${found.cover.height}` : ''}`)
      } catch (error) {
        failed.push(`${entry.book.title}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return { entries: entries.map((entry, index) => withLookup(entry, lookups[index] ?? null)), lookups, failed }
}

function count<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

const format = (counts: Record<string, number>) => Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(', ') || '—'

async function main() {
  const { books: records, warnings: parseWarnings } = parseReadingTracker(readRecords())
  const { overrides, path: overridesPath } = readOverrides()
  const plan = mapFableLibrary(records, overrides)
  const summary = summarizePlan(plan)
  const notes = [...parseWarnings]
  if (overrides.goodreads?.length) {
    notes.push(`The overrides list ${overrides.goodreads.length} Goodreads exports; Regal reads them for read dates, this import does not.`)
  }

  console.log(`Fable import: ${records.length} records${overridesPath ? `, overrides ${overridesPath}` : ', no overrides'}`)
  console.log(`  entries ${summary.entries} (${format(summary.byStatus)})`)
  console.log(`  sessions ${summary.sessions} (${format(summary.byOutcome)}), rated ${summary.rated}`)
  console.log(`  overrides: ${plan.report.dropped.length} dropped, ${plan.report.changes.length} changes; ${plan.report.merged.length} editions merged`)

  const report: Record<string, unknown> = { records: records.length, summary, mapping: plan.report, notes }
  const finish = (exitCode = 0) => {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'report.json'), `${JSON.stringify(report, null, 1)}\n`)
    for (const line of [...plan.report.unmapped.map((item) => `unmapped: ${item.title}: ${item.reason}`), ...plan.report.warnings, ...notes]) {
      console.log(`  ! ${line}`)
    }
    console.log(`Report: ${join(dataDir, 'report.json')}`)
    process.exit(exitCode)
  }

  if (args.plan) finish()

  // Fail before the slow part if the member or the target is wrong.
  const { url, serviceKey, label } = target()
  if (!args.email) fail('--email is required (the member to import into)')
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const memberId = await findMemberId(client, args.email)
  if (!memberId) fail(`no member with the address ${args.email} on ${label}`)

  const looked = await lookUp(plan.entries)
  const coverSources = count(looked.entries.map((entry, index) => looked.lookups[index]?.cover?.source ?? 'none'))
  const bookSources = count(looked.entries.map((entry) => (entry.book.isbn13 || entry.book.appleId || entry.book.openLibraryEditionKey ? entry.book.source : 'manual')))
  console.log(`  covers: ${format(coverSources)}`)
  console.log(`  Book sources: ${format(bookSources)}`)
  if (looked.failed.length) console.log(`  lookups that failed (run again to retry): ${looked.failed.length}`)
  // German reads: what each got, and whether the German National Library has its exact cover (not embeddable; scripts/fable/covers.ts).
  const germanReads = looked.entries.flatMap((entry, index) => entry.readLanguage === 'de'
    ? [{ title: entry.book.title, isbn13: entry.book.isbn13, cover: looked.lookups[index]?.cover?.source ?? 'placeholder', dnb: Boolean(looked.lookups[index]?.dnb) }]
    : [])
  for (const read of germanReads) console.log(`  de: ${read.title} [${read.isbn13 ?? 'no ISBN'}] cover ${read.cover}${read.dnb ? ', DNB has the exact cover' : ''}`)

  console.log(`${args['dry-run'] ? 'Dry run against' : 'Writing to'} ${label} as ${args.email}`)
  const written = await writeImport(client, memberId, looked.entries, {
    dryRun: args['dry-run'],
    prune: args.prune,
  })
  console.log(`  books: ${format(written.books)}`)
  console.log(`  entries: ${format({ ...written.entries, stale: written.entries.stale.length })}`)
  console.log(`  sessions: ${format(written.sessions)}`)
  for (const problem of written.problems) console.log(`  ! ${problem.title} [${problem.key}]: ${problem.problem}`)

  Object.assign(report, {
    target: label,
    member: args.email,
    dryRun: args['dry-run'],
    covers: coverSources,
    bookSources,
    germanReads,
    noCover: looked.entries.filter((entry) => !entry.book.coverUrl).map((entry) => entry.book.title),
    manualBooks: looked.entries.filter((entry) => !entry.book.isbn13 && !entry.book.appleId && !entry.book.openLibraryEditionKey).map((entry) => entry.book.title),
    lookupFailures: looked.failed,
    written,
  })
  finish(written.problems.length ? 1 : 0)
}

main().catch((error: unknown) => fail(error instanceof Error ? error.stack ?? error.message : String(error)))
