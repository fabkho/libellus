/**
 * Filling an edition's page count where nobody knows it yet (docs/proposals/page-counts-2026-11-15.md; the owner's
 * decision: "The page count coming from the edition should be the first and default page count … only backfill page
 * counts which are null, do not touch everything else.").
 *
 *   cd web && pnpm tsx scripts/backfill-page-counts.ts            # dry run: asks Google, writes nothing
 *   cd web && pnpm tsx scripts/backfill-page-counts.ts --apply    # writes the nulls it was told about
 *
 * Why a script and not an edge function: the owner's case is 22 finished reads without a page count, 17 of them Books
 * with an ISBN to ask about, once. A script runs on the machine that has the operator, needs no deploy, no queue and
 * no cron, and can be pointed at a private stack; a recurring pipeline (teaching `enrich` a page count) is the bigger
 * job the proposal names as a *later* step, not this one.
 *
 * What it does, in that order:
 *   1. reads the candidates from the database — a finished read whose page count is unknown in both halves of the
 *      app's rule (`coalesce(entry.page_count_override, book.page_count) is null`, `readsWithoutPages`) on a Catalogue
 *      Book (`owner_id is null`) that has an ISBN (backfill/pageCounts.ts, `CANDIDATES_SQL`);
 *   2. asks `google-books` (`{ action: 'isbn' }`) about each Book's ISBN-13, one at a time, which is 17 requests for the
 *      owner's list — noise beside the function's 900-a-day budget, and its ≤1-day cache answers a second run for
 *      free. It stops at the first `unavailable` (budget spent, key missing, Google refused) rather than burning
 *      through the rest of the list against a closed door;
 *   3. prints what it would write, and with `--apply` writes each count through `private.set_edition_page_count`,
 *      which writes only where `page_count is null` and answers whether it did. Never a second write, never an
 *      overwrite, never `library_entries.page_count_override`.
 *
 * Both the read and the write go over one database connection, not PostgREST: the function lives in `private`, which
 * the API does not expose (supabase/config.toml, `[api] schemas`), so only a database session can call it — which is
 * the point of putting it there. The Google side goes through the deployed function so the cache, the budget and the
 * breaker are all still the function's.
 *
 * Idempotent: the second `--apply` finds no candidate (the counts are there) and writes nothing; a Book somebody filled
 * in between the read and the write makes the RPC answer false, and the run counts it as taken, not as written.
 *
 * Where it writes: the local stack this checkout runs, and nothing else unless asked in so many words
 * (`--target hosted` with `--confirm-host <host>`, `scripts/shared/target.ts`). Dry run is the default: it reads and
 * asks Google, and writes nothing.
 */
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { Client as PgClient } from 'pg'
import { toIsbn13 } from '../app/data/dnbRecord'
import { resolveTarget } from './shared/target'
import {
  askableIsbn,
  CANDIDATES_SQL,
  readAnswer,
  remaining,
  summaryLine,
  type Lookup,
  type PageCountCandidate,
  type RunSummary,
} from './backfill/pageCounts'

const repoRoot = new URL('../..', import.meta.url).pathname

const { values: args } = parseArgs({
  options: {
    'apply': { type: 'boolean', default: false },
    'target': { type: 'string', default: process.env.LIBELLUS_BACKFILL_TARGET ?? 'local' },
    'confirm-host': { type: 'string' },
    'db-url': { type: 'string' },
    'function-url': { type: 'string' },
    'pause-ms': { type: 'string', default: '300' },
    'help': { type: 'boolean', short: 'h', default: false },
  },
})

const HELP = [
  "backfill-page-counts: fill a Catalogue edition's page count where it is null (never an existing one)",
  '',
  '  --apply                write what Google answered (default: dry run, writes nothing)',
  "  --target local|hosted  where to write (default local: this checkout's stack, never a hosted URL by accident)",
  "  --confirm-host <host>  with --target hosted: repeat the URL's host to confirm it",
  '  --db-url <url>         the database to use, when it is not the one the target reports (a stack on other ports)',
  '  --function-url <url>   the API whose google-books the run asks (default: the target\'s; a stack on other ports)',
  '  --pause-ms <n>         wait this long between two Google Books questions (default 300)',
  '',
  'Candidates: a finished read with no page count (no entry override, no edition count) on a Catalogue Book with',
  'an ISBN. One Book is one candidate, however many reads of it are missing the count.',
].join('\n')

if (args.help) {
  console.log(HELP)
  process.exit(0)
}

function fail(message: string): never {
  console.error(`backfill-page-counts: ${message}`)
  process.exit(1)
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The local stack's own `DB_URL` from `supabase status -o env`, run where the stack lives: `$SUPABASE_WORKDIR` when a
 * private throwaway stack is pointed at (docs/plans/book-notes/briefs/README.md sets it for the snapshot too),
 * else this repo. Never a hosted URL: a local run talks to the checkout's stack or to nothing.
 */
function localDbUrl(): string {
  let env: string
  try {
    env = execFileSync('supabase', ['status', '-o', 'env'], {
      cwd: process.env.SUPABASE_WORKDIR ?? repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return fail('no local stack answering: run `supabase start` where it lives (or pass --db-url)')
  }
  const url = env.match(/^DB_URL="?([^"\n]+)"?$/m)?.[1]
  if (!url) return fail('`supabase status` reported no DB_URL (pass --db-url)')
  return url
}

/** The host of a connection string only, for the log: never the credentials, never the password. */
function dbHost(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}:${parsed.port || '5432'}`
  } catch {
    return 'database (url unreadable)'
  }
}

/** One ISBN question to the `google-books` function, as the service role (so no member's 60-a-day limit). */
async function askGoogle(url: string, serviceKey: string, isbn13: string): Promise<Lookup> {
  let response: Response
  try {
    response = await fetch(`${url}/functions/v1/google-books`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ action: 'isbn', isbn13 }),
    })
  } catch (error) {
    return { kind: 'unavailable', reason: `unreachable: ${error instanceof Error ? error.message : String(error)}` }
  }
  const body = await response.json().catch(() => null)
  if (response.status === 401) return { kind: 'unavailable', reason: 'unauthorized' }
  return readAnswer(response.status, body)
}

/** The candidates, from the database the target names. */
async function readCandidates(client: PgClient): Promise<PageCountCandidate[]> {
  const { rows } = await client.query<{ book_id: string; isbn13: string | null; isbn10: string | null; reads: number }>(CANDIDATES_SQL)
  return rows.map((row) => ({ bookId: row.book_id, isbn13: row.isbn13, isbn10: row.isbn10, reads: row.reads }))
}

/** The one write: the RPC that fills a null and answers whether it did. */
async function writeCount(client: PgClient, bookId: string, pageCount: number): Promise<boolean> {
  const { rows } = await client.query<{ written: boolean }>('select private.set_edition_page_count($1, $2) as written', [bookId, pageCount])
  return rows[0]?.written === true
}

async function main() {
  const target = resolveTarget({ target: args.target, confirmHost: args['confirm-host'], repoRoot, action: 'writes to', fail })
  const functionUrl = args['function-url'] ?? target.url
  const dbUrl = args['db-url'] ?? (args.target === 'local' ? localDbUrl() : process.env.SUPABASE_DB_URL)
  if (!dbUrl) fail('--target hosted needs SUPABASE_DB_URL (or --db-url): the function is in `private`, so it is called over a database session')
  const pauseMs = Number(args['pause-ms'] ?? 300)
  console.log(`Page-count backfill: ${target.label}, database ${dbHost(dbUrl)}, google-books at ${functionUrl}`)
  console.log(`  ${args.apply ? 'APPLY: nulls will be written' : 'dry run: nothing is written (pass --apply to write)'}`)

  const client = new PgClient({ connectionString: dbUrl })
  await client.connect()
  try {
    const candidates = await readCandidates(client)
    const summary: RunSummary = { candidates: candidates.length, askable: 0, asked: 0, answered: 0, without: 0, written: 0, taken: 0, left: 0, stopReason: null }
    if (!candidates.length) {
      console.log('  no candidates: every finished read has a page count, or no Catalogue Book is missing one')
      console.log(summaryLine(summary))
      return
    }

    for (const [index, candidate] of candidates.entries()) {
      if (summary.stopReason) break
      const at = `${index + 1}/${candidates.length} ${candidate.bookId}`
      const isbn13 = askableIsbn(candidate, toIsbn13)
      if (!isbn13) {
        // Not this run's: the Apple imports with no ISBN at all (5 of the owner's 22), which need a manual path.
        console.log(`  ${at}: no ISBN to ask about, skipped`)
        continue
      }
      summary.askable++
      if (index > 0 && pauseMs > 0) await delay(pauseMs)
      const lookup = await askGoogle(functionUrl, target.serviceKey, isbn13)
      summary.asked++
      if (lookup.kind === 'unavailable') {
        summary.stopReason = lookup.reason
        console.log(`  ${at}: the function could not ask (${lookup.reason}), stopping`)
        break
      }
      if (lookup.kind === 'unknown') {
        summary.without++
        console.log(`  ${at} (${isbn13}): Google does not know this ISBN`)
        continue
      }
      if (lookup.kind === 'no-pages') {
        summary.without++
        console.log(`  ${at} (${isbn13}): Google knows it, says no page count`)
        continue
      }
      summary.answered++
      if (!args.apply) {
        console.log(`  ${at} (${isbn13}): would write ${lookup.pageCount} pages (${candidate.reads} finished read(s))`)
        continue
      }
      if (await writeCount(client, candidate.bookId, lookup.pageCount)) {
        summary.written++
        console.log(`  ${at} (${isbn13}): wrote ${lookup.pageCount} pages (${candidate.reads} finished read(s))`)
      } else {
        summary.taken++
        console.log(`  ${at} (${isbn13}): already had a count, left alone`)
      }
    }

    summary.left = remaining(args.apply ? summary : { ...summary, written: 0 })
    if (summary.stopReason) console.log(`  stopped asking: ${summary.stopReason}`)
    console.log(summaryLine(summary))
  } finally {
    await client.end()
  }
}

await main()
