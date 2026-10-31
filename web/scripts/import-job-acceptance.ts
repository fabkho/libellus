/**
 * The acceptance run of the import job (proposal #329, part 6): a real export through the REAL job path on the LOCAL stack —
 * `start_import_job` with the rows as the app uploads them (the app's own parser, `data/import`), the `import-job` function's chunks
 * re-triggered by the database (pg_net `private.import_job_kick` after every chunk, pg_cron's `import-job-tick` as the safety net),
 * matching → cover stage → write → done — against the live sources (Open Library through its shared pace, the DNB and Goodreads through
 * their functions). Nothing is wired here but the member and the function's address; no matching or cover code runs in this script.
 *
 * It prints COUNTS only (never a title, an author or an ISBN) and exits 1 when the job did not finish in time, any row's write failed or
 * more than `LIBELLUS_ACCEPT_MAX_NO_COVER` (5) Library entries have no cover at the end (the owner's criterion: close to 0).
 *
 *   LIBELLUS_IMPORT_CSV=/path/export.csv       (or a Hardcover "everything" zip: the bytes decide, as on the Import page with
 *                                              NUXT_PUBLIC_IMPORT_ZIP=on; docs/plans/hardcover-zip.md) \
 *   IMPORT_JOB_TOKEN=<the token the stack's `import-job` function was started with> \
 *   [LIBELLUS_ACCEPT_MAX_NO_COVER=5]       threshold: rows without any cover at the end
 *   [LIBELLUS_ACCEPT_LIMIT=40]             only the first N rows of the file (a smoke run)
 *   [LIBELLUS_ACCEPT_TIMEOUT_MIN=90]       give up after this long
 *   [LIBELLUS_ACCEPT_KICK=db|manual]       db (default): the database re-triggers (pg_net + pg_cron), as in production;
 *                                          manual: this script posts the `run` action itself, as cron would, while the job is live
 *   [LIBELLUS_ACCEPT_FUNCTION_URL=…]       the function's address as the DATABASE reaches it (default http://kong:8000/functions/v1/import-job:
 *                                          the Supabase API gateway inside the stack's Docker network)
 *   [LIBELLUS_ACCEPT_CONTAINER=…]          the stack's edge runtime container, whose log is read for chunks, asks and lease losses
 *                                          (default supabase_edge_runtime_<project_id>, the project id from supabase/config.toml)
 *   [LIBELLUS_ACCEPT_KEEP=1]               keep the member and the job's rows afterwards
 *   SUPABASE_URL=… SUPABASE_DB_URL=… MAILPIT_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… pnpm tsx scripts/import-job-acceptance.ts
 *
 * The stack needs the function's secrets (`OPENLIBRARY_CONTACT`, `IMPORT_JOB_TOKEN`): supabase/functions/import-job/README.md, "Acceptance run".
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createAuth } from '../app/data/auth'
import { decodeExport } from '../app/data/import/csv'
import { parseExport } from '../app/data/import/detect'
import type { ImportFile } from '../app/data/import/rows'
import { uploadRow } from '../app/data/importUpload'
import { createInviteCode, newClient, readMailedCode, sleep, sql, stack, uniqueEmail } from '../tests/support/stack'

const file = process.env.LIBELLUS_IMPORT_CSV
const token = process.env.IMPORT_JOB_TOKEN
if (!file || !token) {
  console.error('import-job-acceptance: name the export and the function token: LIBELLUS_IMPORT_CSV=/path/export.csv IMPORT_JOB_TOKEN=… pnpm tsx scripts/import-job-acceptance.ts')
  process.exit(2)
}
process.env.LIBELLUS_TEST_RUN ??= 'job-acceptance'
const maxNoCover = Number(process.env.LIBELLUS_ACCEPT_MAX_NO_COVER ?? 5)
const limit = Number(process.env.LIBELLUS_ACCEPT_LIMIT ?? 0)
const timeoutMs = Number(process.env.LIBELLUS_ACCEPT_TIMEOUT_MIN ?? 90) * 60_000
const manual = (process.env.LIBELLUS_ACCEPT_KICK ?? 'db') === 'manual'
const functionUrl = process.env.LIBELLUS_ACCEPT_FUNCTION_URL ?? 'http://kong:8000/functions/v1/import-job'
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8'))?.[1]
const container = process.env.LIBELLUS_ACCEPT_CONTAINER ?? `supabase_edge_runtime_${projectId}`
/** `covers.ts` GOODREADS_TRIES: a row asked this many times without an answer is given up. */
const GOODREADS_TRIES = 3
const GAP_SECONDS = 5

const today = new Date().toISOString().slice(0, 10)
const started = Date.now()
const seconds = (since = started) => Math.round((Date.now() - since) / 1000)

// ------------------------------------------------------------------- the rows, as the app uploads them

const bytes = new Uint8Array(readFileSync(file))
// What the app uploads of a parsed row is `uploadRow` (data/importUpload.ts: the row with the Collections she keeps and, for a zip, its progress);
// a zip's lists (`collectionOrder`, `emptyCollections`) go with the start, as the Import page sends them.
let parsed: ImportFile
if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
  const { mapHardcoverExport, readHardcoverZip } = await import('../app/data/import/hardcoverZip')
  parsed = mapHardcoverExport(await readHardcoverZip(bytes), today)
} else {
  parsed = parseExport(decodeExport(bytes), today)
}
const rows = (limit ? parsed.books.slice(0, limit) : parsed.books).map(uploadRow)
console.error(`import-job-acceptance: ${rows.length} rows of a ${parsed.source} file`)

// ------------------------------------------------------------------- the member and the job's address

const client = newClient()
const auth = createAuth(client)
const email = uniqueEmail('job-acceptance')
const requested = await auth.requestSignUpCode({ email, inviteCode: await createInviteCode({ maxUses: 1 }) })
if (requested.error) throw new Error(`sign-up failed: ${requested.error}`)
const verified = await auth.verifyCode(email, await readMailedCode(email))
if (verified.error) throw new Error(`verification failed: ${verified.error}`)
const member = await auth.currentMember()
if (!member) throw new Error('no session')

// One-time owner setup, exactly as the README's Deploy section says; nothing is kicked without it (the local stack's default).
if (!manual) {
  await sql('update private.import_job_settings set function_url = $1', [functionUrl])
  await sql(`delete from vault.secrets where name = 'import_job_token'`)
  await sql(`select vault.create_secret($1, 'import_job_token')`, [token])
}
// Whatever an earlier run left in the queue is not this run's.
await sql(`update public.import_jobs set state = 'cancelled', finished_at = now() where state in ('queued', 'running', 'paused')`)
const netBefore = await sql<{ n: string }>(`select count(*)::text n from net._http_response`)

// ------------------------------------------------------------------- start, then watch

const startedAt = new Date()
const { data: jobId, error: startError } = await client.rpc('start_import_job', {
  p_rows: rows,
  p_source: parsed.source,
  p_device: 'job-acceptance',
  p_already: 0,
  p_languages: ['de-DE', 'en-US'],
  ...(parsed.collectionOrder?.length ? { p_collection_order: parsed.collectionOrder } : {}),
  ...(parsed.emptyCollections?.length ? { p_empty_collections: parsed.emptyCollections } : {}),
})
if (startError || typeof jobId !== 'string') throw new Error(`start_import_job failed: ${startError?.message}`)

type Progress = { state: string; total: number; matched: number; covered: number; written: number; chunks: number; stalls: number }
async function progress(): Promise<Progress> {
  const [row] = await sql<Progress>(
    `select j.state, j.total, j.chunks, j.stalls,
            (select count(*)::int from public.import_job_rows r where r.job_id = j.id and r.state = 'done') matched,
            (select count(*)::int from public.import_job_rows r where r.job_id = j.id and r.cover_state = 'done') covered,
            (select count(*)::int from public.import_job_rows r where r.job_id = j.id and r.write_state = 'done') written
       from public.import_jobs j where j.id = $1`,
    [jobId],
  )
  return row!
}

const phaseAt: Record<'matched' | 'covered' | 'written', number | null> = { matched: null, covered: null, written: null }
let pausedSeconds = 0
let pauses = 0
let wasPaused = false
let last: Progress = await progress()
let lastPrint = 0
while (!['done', 'failed', 'cancelled'].includes(last.state) && Date.now() - started < timeoutMs) {
  if (manual && ['queued', 'running', 'paused'].includes(last.state)) {
    // As cron would: the function answers `idle` while nothing is due (a paused job, a lease that holds).
    await fetch(stack.url + '/functions/v1/import-job', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'run' }),
    }).catch(() => null)
  }
  await sleep(GAP_SECONDS * 1000)
  last = await progress()
  for (const phase of ['matched', 'covered', 'written'] as const) {
    if (phaseAt[phase] === null && last[phase] >= last.total) phaseAt[phase] = seconds()
  }
  if (last.state === 'paused') {
    pausedSeconds += GAP_SECONDS
    if (!wasPaused) pauses++
  }
  wasPaused = last.state === 'paused'
  if (seconds() - lastPrint >= 60) {
    lastPrint = seconds()
    console.error(`  ${seconds()} s: ${last.state}, matched ${last.matched}/${last.total}, covers ${last.covered}, written ${last.written}, chunks ${last.chunks}`)
  }
}
const totalSeconds = seconds()

// ------------------------------------------------------------------- the counts

const [job] = await sql<Record<string, number | string | null>>(
  `select state, total, done, added, kept, failed, needs_look, chunks, stalls, error,
          cover_edition, cover_lent, cover_openlibrary, cover_goodreads, cover_none
     from public.import_jobs where id = $1`,
  [jobId],
)
const [byRow] = await sql<Record<string, number>>(
  `select count(*) filter (where verdict = 'matched')::int matched,
          count(*) filter (where verdict = 'fromFile')::int from_file,
          count(*) filter (where verdict in ('inLibrary', 'imported'))::int in_library,
          count(*) filter (where cover_source = 'none')::int cover_none,
          count(*) filter (where cover_source = 'none' and (coalesce(btrim(payload ->> 'title'), '') = ''
                                                            or not exists (select 1 from jsonb_array_elements_text(coalesce(payload -> 'authors', '[]')) a where btrim(a) <> '')))::int none_no_title,
          count(*) filter (where cover_source = 'none' and cover_tries >= ${GOODREADS_TRIES - 1}
                                 and coalesce(btrim(payload ->> 'title'), '') <> ''
                                 and exists (select 1 from jsonb_array_elements_text(coalesce(payload -> 'authors', '[]')) a where btrim(a) <> ''))::int none_unsure,
          count(*) filter (where cover_source is distinct from 'none' and cover_url is null)::int decided_without_address,
          count(*) filter (where cover_state <> 'done')::int cover_undecided,
          count(*) filter (where write_state <> 'done')::int write_pending,
          count(*) filter (where outcome = 'failed')::int write_failed
     from public.import_job_rows where job_id = $1`,
  [jobId],
)
const failedReasons = await sql<{ error: string | null; n: number }>(
  `select coalesce(error, '(none)') error, count(*)::int n from public.import_job_rows where job_id = $1 and outcome = 'failed' group by 1`,
  [jobId],
)
// What the member ends with: Library entries of this member whose Book has no cover.
const [library] = await sql<{ entries: number; no_cover: number }>(
  `select count(*)::int entries, count(*) filter (where b.cover_url is null)::int no_cover
     from public.library_entries e join public.books b on b.id = e.book_id where e.member_id = $1`,
  [member.id],
)
// What the import made of her shelves and lists (counts only).
const [shelves] = await sql<Record<string, number>>(
  `select count(*) filter (where status = 'finished')::int finished, count(*) filter (where status = 'reading')::int reading,
          count(*) filter (where status = 'want_to_read')::int want_to_read,
          (select count(*)::int from public.collections c where c.member_id = $1) collections,
          (select count(*)::int from public.collection_entries ce join public.collections c on c.id = ce.collection_id where c.member_id = $1) collection_entries,
          (select count(*)::int from public.collections c where c.member_id = $1
             and not exists (select 1 from public.collection_entries ce where ce.collection_id = c.id)) collections_empty
     from public.library_entries where member_id = $1`,
  [member.id],
)
// A Hardcover zip's extras (counts only): reads with a place (page / percent), the ranked lists and whether each is in the file's order
// (her entries of the file's keys, by position, are the keys in the file's rank order), and the lists she has left empty.
const [places] = await sql<{ page: number; percent: number; reading_day: number }>(
  `select count(*) filter (where s.progress_page is not null)::int page, count(*) filter (where s.progress_percent is not null)::int percent,
          (select count(*)::int from public.reading_progress_days d join public.reading_sessions s2 on s2.id = d.session_id
             join public.library_entries e2 on e2.id = s2.entry_id where e2.member_id = $1) reading_day
     from public.reading_sessions s join public.library_entries e on e.id = s.entry_id where e.member_id = $1`,
  [member.id],
)
let rankedInOrder = 0
for (const list of parsed.collectionOrder ?? []) {
  const have = await sql<{ import_key: string }>(
    `select e.import_key from public.collections c join public.collection_entries ce on ce.collection_id = c.id
       join public.library_entries e on e.id = ce.entry_id where c.member_id = $1 and lower(c.name) = lower($2) order by ce.position`,
    [member.id, list.name],
  )
  const wanted = list.keys.filter((key) => have.some((row) => row.import_key === key))
  if (JSON.stringify(have.map((row) => row.import_key).filter((key) => list.keys.includes(key))) === JSON.stringify(wanted)) rankedInOrder++
}
const lists = { fileRanked: parsed.collectionOrder?.length ?? 0, rankedInOrder, fileEmpty: parsed.emptyCollections?.length ?? 0 }
const [net] = await sql<{ n: string; failed: string }>(
  `select count(*)::text n, count(*) filter (where timed_out or status_code is distinct from 200)::text failed from net._http_response where created >= $1`,
  [startedAt],
)

// The function's own log: chunks, what each asked upstream, lease losses, failures.
type LogCounts = { chunkLines: number; more: number; paused: number; gone: number; chunkFailed: number; runFailed: number; goodreadsBlocked: number; goodreadsUnsure: number }
const logCounts: LogCounts = { chunkLines: 0, more: 0, paused: 0, gone: 0, chunkFailed: 0, runFailed: 0, goodreadsBlocked: 0, goodreadsUnsure: 0 }
const asked: Record<string, number> = {}
/** The functions' own error log lines (`goodreads_cover_empty`, refusals …) by their tag. */
const errorLines: Record<string, number> = {}
let logRead = true
try {
  // The container's log: console.log lands on its stdout, the functions' errors on its stderr.
  const read = spawnSync('docker', ['logs', '--since', startedAt.toISOString(), container], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (read.status !== 0) throw new Error(read.stderr)
  const log = `${read.stdout}\n${read.stderr}`
  for (const line of log.split('\n')) {
    if (/import-job: \S+ chunk (more|done|paused):/.test(line)) {
      logCounts.chunkLines++
      const state = /chunk (more|done|paused):/.exec(line)![1] as 'more' | 'paused'
      if (state === 'more') logCounts.more++
      if (state === 'paused') logCounts.paused++
    }
    if (/chunk gone/.test(line)) logCounts.gone++
    if (/import-job: chunk of \S+ failed/.test(line)) logCounts.chunkFailed++
    if (/import-job: run failed/.test(line)) logCounts.runFailed++
    if (/goodreads blocked/.test(line)) logCounts.goodreadsBlocked++
    const unsure = /goodreads covers for \d+ rows: \d+ found, \d+ none, (\d+) unsure/.exec(line)
    if (unsure) logCounts.goodreadsUnsure += Number(unsure[1])
    const logged = /^\[Error\] (\w+)/.exec(line)
    if (logged) errorLines[logged[1]!] = (errorLines[logged[1]!] ?? 0) + 1
    const sourceAsks = /import-job: asked (\{.*\})/.exec(line)
    if (sourceAsks) for (const [name, count] of Object.entries(JSON.parse(sourceAsks[1]!) as Record<string, number>)) asked[name] = (asked[name] ?? 0) + count
  }
} catch {
  logRead = false
}

const noCover = library?.no_cover ?? -1
const report = {
  rows: rows.length,
  shelves,
  progress: places,
  lists,
  job: { state: job?.state, chunks: job?.chunks, stalls: job?.stalls, error: job?.error ?? null },
  matched: byRow?.matched,
  fromFile: byRow?.from_file,
  alreadyInLibrary: byRow?.in_library,
  needsLook: job?.needs_look,
  write: { added: job?.added, kept: job?.kept, failed: job?.failed, failedReasons: failedReasons.map((r) => `${r.error} x${r.n}`) },
  coversBySource: {
    edition: job?.cover_edition,
    lent: job?.cover_lent,
    openlibrary: job?.cover_openlibrary,
    goodreads: job?.cover_goodreads,
    none: job?.cover_none,
  },
  rowsWithoutCover: {
    jobRows: byRow?.cover_none,
    byCause: { noTitleOrAuthor: byRow?.none_no_title, unsureAfterRetries: byRow?.none_unsure, goodreadsNone: (byRow?.cover_none ?? 0) - (byRow?.none_no_title ?? 0) - (byRow?.none_unsure ?? 0) },
    libraryEntries: library?.entries,
    libraryEntriesWithoutCover: noCover,
  },
  seconds: { total: totalSeconds, matching: phaseAt.matched, coverStage: phaseAt.covered && phaseAt.matched ? phaseAt.covered - phaseAt.matched : null, write: phaseAt.written && phaseAt.covered ? phaseAt.written - phaseAt.covered : null, paused: pausedSeconds },
  chunks: { claimed: job?.chunks, retriggersSent: Number(net?.n ?? 0) - 0, retriggersNot200: Number(net?.failed ?? 0), netResponsesBefore: Number(netBefore[0]?.n ?? 0), pauses, ...(logRead ? logCounts : { log: 'unreadable' }) },
  upstreamAsks: logRead ? asked : 'unreadable',
  functionErrorLog: logRead ? errorLines : 'unreadable',
  leaseLossOrStall: { gone: logRead ? logCounts.gone : null, stalls: job?.stalls, chunkFailed: logRead ? logCounts.chunkFailed : null },
  unfinished: { coverUndecided: byRow?.cover_undecided, writePending: byRow?.write_pending, decidedWithoutAddress: byRow?.decided_without_address },
}
console.log(JSON.stringify(report, null, 2))

if (!process.env.LIBELLUS_ACCEPT_KEEP) await sql('delete from auth.users where id = $1 and email = $2', [member.id, email])

const problems: string[] = []
if (job?.state !== 'done') problems.push(`the job is ${job?.state} after ${totalSeconds} s, not done`)
if (Number(job?.failed ?? 0) > 0) problems.push(`${job?.failed} rows failed to write`)
if (lists.rankedInOrder !== lists.fileRanked) problems.push(`${lists.fileRanked - lists.rankedInOrder} ranked Collections are not in the file's order`)
if (Number(places?.reading_day ?? 0) > 0) problems.push('the import wrote reading days')
if (noCover < 0 || noCover > maxNoCover) problems.push(`${noCover} Library entries without a cover (threshold ${maxNoCover})`)
if (problems.length) {
  console.error(`import-job-acceptance: FAILED: ${problems.join('; ')}`)
  process.exit(1)
}
console.error(`import-job-acceptance: passed (${noCover} without a cover, threshold ${maxNoCover})`)
