/**
 * The Reado import (stage 1): the Reado app's own data export into one member's
 * Library, once per account, idempotently. The sibling of `import-fable.ts`.
 *
 *   pnpm import:reado --from <export.json> --email <member> [options]
 *   pnpm import:reado --from <export.json> --plan          # map only: counts and the report
 *
 * Options:
 *   --from <file.json>    the export (Reado → the iOS app's data export, schemaVersion 1). Required.
 *                         The file is the owner's private data: never put it in the repo.
 *   --email <address>     the member to import into (must exist)
 *   --target local|hosted local (default): the stack `supabase status` reports.
 *                         hosted: $SUPABASE_URL + $SUPABASE_SERVICE_ROLE_KEY,
 *                         and --confirm-host <host> must name the URL's host
 *   --dry-run             read the target, write nothing, print what would change
 *   --plan                map only: no target, no lookups
 *   --started-only skip|want
 *                         a START and nothing else, on no shelf: left out (default)
 *                         or Want to read
 *   --aborted dnf|skip    an ABORT event: a DNF session (default) or left out
 *   --no-collections      do not make Collections of the custom lists and favourites
 *   --no-covers           titles only: no cover lookups (the Book keeps the cover
 *                         its ISBN lookup found)
 *   --prune               delete this member's `reado:` entries the export no longer has
 *                         (do not combine two accounts in one member with this)
 *   --offline             no lookups at all: only what .data/ already knows
 *   --refresh             look every ISBN and cover up again, ignoring .data/
 *
 * The pipeline: read the export (app/data/import/reado.ts, pure, tested) → map
 * it → look up each ISBN's edition for its title (scripts/reado/editions.ts,
 * the barcode lookup the app has) and its cover (scripts/fable/covers.ts) →
 * write as the service role (scripts/fable/write.ts, then
 * scripts/reado/collections.ts). Real data stays out of git: the caches and the
 * report live in the repo's `.data/`, which is ignored.
 *
 * What it cannot import is reported, not hidden: every book the export names
 * only by `p_id` (see the header of app/data/import/reado.ts) is counted by
 * reason at the end and written to the report, for stage 2.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import {
  mapReadoExport,
  NotAReadoExportError,
  parseReadoExport,
  summarizeReado,
  toImportEntry,
  READO_KEY_PREFIX,
  type ReadoOptions,
} from '../app/data/import/reado'
import { findMemberId, writeImport } from './fable/write'
import { writeCollections } from './reado/collections'
import { resolveEditions } from './reado/editions'
import { lookUpEntries } from './reado/lookups'
import { resolveTarget } from './shared/target'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const dataDir = join(repoRoot, '.data', 'reado-import')
const expandHome = (path: string) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)

const { values: args } = parseArgs({
  options: {
    'from': { type: 'string' },
    'email': { type: 'string' },
    'target': { type: 'string', default: process.env.LIBELLUS_IMPORT_TARGET ?? 'local' },
    'confirm-host': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'plan': { type: 'boolean', default: false },
    'started-only': { type: 'string', default: 'skip' },
    'aborted': { type: 'string', default: 'dnf' },
    'no-collections': { type: 'boolean', default: false },
    'no-covers': { type: 'boolean', default: false },
    'prune': { type: 'boolean', default: false },
    'offline': { type: 'boolean', default: false },
    'refresh': { type: 'boolean', default: false },
    'help': { type: 'boolean', short: 'h', default: false },
  },
})

function fail(message: string): never {
  console.error(`import-reado: ${message}`)
  process.exit(1)
}

if (args.help) {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  console.log(source.slice(source.indexOf('/**') + 3, source.indexOf('*/')).replace(/^ \* ?/gm, ''))
  process.exit(0)
}

const oneOf = <T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T =>
  allowed.includes(value as T) ? (value as T) : fail(`--${name} must be ${allowed.join(' or ')}, not "${value}"`)

const format = (counts: Record<string, number>) => Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(', ') || '—'

async function main() {
  if (!args.from) fail('--from <export.json> is required')
  const file = resolve(expandHome(args.from))
  if (!existsSync(file)) fail(`no such file: ${file}`)
  const options: ReadoOptions = {
    startedOnly: oneOf('started-only', args['started-only'], ['skip', 'want'] as const),
    aborted: oneOf('aborted', args.aborted, ['dnf', 'skip'] as const),
    collections: !args['no-collections'],
  }

  let plan
  try {
    plan = mapReadoExport(parseReadoExport(readFileSync(file, 'utf8')), options)
  } catch (error) {
    if (error instanceof NotAReadoExportError) fail(error.message)
    throw error
  }
  const { report } = plan
  const { details, ...unattachable } = report.unattachable
  const summary = summarizeReado(plan)

  console.log(`Reado import: export of ${report.generatedAt ?? '?'}`)
  console.log(`  journal ${report.journal.books} books (${report.journal.isbn13} ISBN, ${report.journal.asin} Kindle ASIN) in ${report.journal.records} records`)
  console.log(`  p_ids attached to an ISBN: ${report.bridge.pIds} (${report.bridge.viaList} by the shelf item's ISBN, ${report.bridge.viaJournal} by dated events); ambiguous ${report.bridge.ambiguous}`)
  console.log(`  entries ${summary.entries} (${format(summary.byStatus)})`)
  console.log(`  sessions ${summary.sessions} (${format(summary.byOutcome)}), rated ${summary.rated}, reviewed ${summary.reviewed}, undated ${summary.undatedReads}`)
  console.log(`  collections ${summary.collections} with ${summary.collectionEntries} entries: ${plan.collections.map((collection) => `${collection.name} ${collection.keys.length}`).join(', ') || '—'}`)

  const reportOut: Record<string, unknown> = { file: file.replace(homedir(), '~'), options, summary, report: { ...report, unattachable }, unattached: details }
  const reportPath = join(dataDir, `report-${(args.plan ? 'plan' : args.email ?? 'run').replace(/[^\w.@-]+/g, '_')}.json`)
  const finish = (exitCode = 0) => {
    // Loud, and last: what this run did not bring over.
    console.log('NOT IMPORTED (stage 2 needs the p_id → ISBN bridge):')
    console.log(`  ${unattachable.pIds} books known only by a p_id: ${unattachable.shelfItems} shelf items (${format(unattachable.byList)})`)
    console.log(`  of them finished ${unattachable.finished}, started ${unattachable.started}, rated ${unattachable.rated}, reviewed ${unattachable.reviewed}; ${unattachable.progressEntries} progress entries in ${unattachable.newJournalEntries} newJournal entries`)
    console.log(`  customBooks ${format(unattachable.customBooks)}`)
    console.log(`  posts ${format(unattachable.posts)}`)
    console.log(`  ${report.noIsbn.length} journal books with no ISBN (Kindle ASIN): ${report.noIsbn.filter((book) => book.finished).length} finished, ${report.noIsbn.filter((book) => book.rated).length} rated`)
    console.log(`  ${report.skipped.length} ISBN books left out by option: ${report.skipped.slice(0, 3).map((item) => item.reason).join('; ')}${report.skipped.length > 3 ? '; …' : ''}`)
    for (const item of report.notes) console.log(`  ! ${item.key}: ${item.note}`)
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(reportOut, null, 1)}\n`)
    console.log(`Report: ${reportPath}`)
    process.exit(exitCode)
  }

  if (args.plan) finish()

  // Fail before the slow part if the member or the target is wrong.
  const { url, serviceKey, label } = resolveTarget({ target: args.target, confirmHost: args['confirm-host'], repoRoot, action: 'writes to', fail })
  if (!args.email) fail('--email is required (the member to import into)')
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const memberId = await findMemberId(client, args.email)
  if (!memberId) fail(`no member with the address ${args.email} on ${label}`)

  // The export has no titles: every ISBN is looked up (cached in .data/).
  const editions = await resolveEditions(plan.books.map((book) => book.isbn13), {
    cachePath: join(dataDir, 'editions.json'),
    offline: args.offline,
    refresh: args.refresh,
    log: (line) => console.log(line),
  })
  const noEdition = plan.books.filter((book) => !editions.found.has(book.isbn13))
  console.log(`  titles: ${editions.found.size} found, ${editions.missing.length} unknown to Apple and OpenLibrary, ${editions.failed.length} could not be asked${editions.failed.length ? ' (run again to retry)' : ''}`)
  Object.assign(reportOut, {
    noEdition: noEdition.map((book) => ({
      key: book.key,
      isbn13: book.isbn13,
      why: editions.failed.includes(book.isbn13) ? 'could not be asked' : 'no title found',
      status: book.status,
      finishedOn: book.sessions.find((session) => session.outcome === 'finished')?.endedOn ?? null,
      rated: book.sessions.some((session) => session.rating !== null),
    })),
  })
  if (noEdition.length) console.log(`  ! ${noEdition.length} ISBN books have no title and are not written: ${noEdition.slice(0, 5).map((book) => book.isbn13).join(', ')}${noEdition.length > 5 ? ', …' : ''}`)

  let entries = plan.books.flatMap((book) => (editions.found.has(book.isbn13) ? [toImportEntry(book, editions.found.get(book.isbn13)!)] : []))
  if (!args['no-covers']) {
    const looked = await lookUpEntries(entries, {
      cachePath: join(dataDir, 'lookups.json'),
      offline: args.offline,
      refresh: args.refresh,
      log: (line) => console.log(line),
    })
    entries = looked.entries
    if (looked.failed.length) console.log(`  cover lookups that failed (run again to retry): ${looked.failed.length}`)
    Object.assign(reportOut, { coverLookupFailures: looked.failed })
  }

  console.log(`${args['dry-run'] ? 'Dry run against' : 'Writing to'} ${label} as ${args.email}`)
  const written = await writeImport(client, memberId, entries, { dryRun: args['dry-run'], prune: args.prune, keyPrefix: READO_KEY_PREFIX })
  console.log(`  books: ${format(written.books)}`)
  console.log(`  entries: ${format({ ...written.entries, stale: written.entries.stale.length })}`)
  console.log(`  sessions: ${format(written.sessions)}`)
  for (const problem of written.problems) console.log(`  ! ${problem.title} [${problem.key}]: ${problem.problem}`)

  const written_ = new Set(entries.map((entry) => entry.key))
  const collections = await writeCollections(
    client,
    memberId,
    plan.collections.map((collection) => ({ ...collection, keys: collection.keys.filter((key) => written_.has(key)) })).filter((collection) => collection.keys.length),
    { dryRun: args['dry-run'], log: (line) => console.log(line) },
  )
  console.log(`  collections: ${format(collections.collections)}; memberships ${format(collections.memberships)}`)

  Object.assign(reportOut, { target: label, member: args.email, dryRun: args['dry-run'], written, collections })
  finish(written.problems.length ? 1 : 0)
}

main().catch((error: unknown) => fail(error instanceof Error ? error.stack ?? error.message : String(error)))
