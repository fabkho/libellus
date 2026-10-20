import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The import as the server runs it (proposal #329; supabase/functions/import-job/README.md): the app reads the file on the
 * device, uploads its rows (`start_import_job`) and from then on only watches the member's own job, `import_jobs`
 * (RLS select-own; Realtime in `data/importJobFeed.ts`). This is the one place that talks to the job's tables and functions.
 *
 * Framework-free: the client comes in from outside.
 */

/** The job's own states (supabase/migrations/20261102010000_import_jobs.sql). */
export type ImportJobState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

/**
 * One job as the app sees it: the rows of the file it took on (`total`) and how far each phase is. The server does the phases one
 * after the other, over every row: `matched` rows looked up, `covered` rows with their cover decided, `written` rows written
 * (`added + kept + failed`). `kept` is what was in her Library before as well: the job's own count plus the rows the device
 * never uploaded (`already`).
 */
export type ImportJob = {
  id: string
  state: ImportJobState
  total: number
  matched: number
  covered: number
  written: number
  added: number
  kept: number
  failed: number
  error: string | null
  finishedAt: string | null
}

/** The columns the app reads of a job (and what a Realtime change carries: the whole row). */
export const JOB_COLUMNS =
  'id, state, total, done, added, kept, failed, already, cover_edition, cover_lent, cover_openlibrary, cover_goodreads, cover_none, error, finished_at'

type JobRow = {
  id: string
  state: string
  total: number
  done: number
  added: number
  kept: number
  failed: number
  already: number
  cover_edition: number
  cover_lent: number
  cover_openlibrary: number
  cover_goodreads: number
  cover_none: number
  error: string | null
  finished_at: string | null
}

const STATES: readonly string[] = ['queued', 'running', 'paused', 'done', 'failed', 'cancelled']

/** A job row (a read, or a Realtime change) as the app's job; null when it is not one. */
export function jobOf(row: unknown): ImportJob | null {
  const value = row as Partial<JobRow> | null
  if (!value || typeof value.id !== 'string' || typeof value.state !== 'string' || !STATES.includes(value.state) || typeof value.total !== 'number') return null
  const count = (field: number | undefined) => (typeof field === 'number' && field > 0 ? field : 0)
  const added = count(value.added)
  const kept = count(value.kept)
  const failed = count(value.failed)
  return {
    id: value.id,
    state: value.state as ImportJobState,
    total: value.total,
    matched: count(value.done),
    covered: count(value.cover_edition) + count(value.cover_lent) + count(value.cover_openlibrary) + count(value.cover_goodreads) + count(value.cover_none),
    written: added + kept + failed,
    added,
    kept: kept + count(value.already),
    failed,
    error: value.error ?? null,
    finishedAt: value.finished_at ?? null,
  }
}

/** A job that still has work to do (it is in the queue, running or paused): the app follows it live. */
export const isLive = (job: Pick<ImportJob, 'state'> | null): boolean => job?.state === 'queued' || job?.state === 'running' || job?.state === 'paused'

/** Why the job could not be started (or retried); `import_too_soon` and `device_import_running` are the server's refusals. */
export type ImportJobError = 'import_too_soon' | 'device_import_running' | 'import_running' | 'rows_invalid' | 'job_unknown' | 'offline' | 'unknown'

export type JobResult<T> = { data: T; error: null } | { data: null; error: ImportJobError }

const RAISED: readonly ImportJobError[] = ['import_too_soon', 'device_import_running', 'import_running', 'rows_invalid', 'job_unknown']

function errorOf(failure: { message?: string; code?: string }, status?: number): ImportJobError {
  if (status === 0) return 'offline'
  const raised = RAISED.find((code) => failure.message === code)
  // `job_not_failed`: the job is not failed any more (it was retried from another device): nothing to retry.
  if (failure.message === 'job_not_failed') return 'job_unknown'
  return raised ?? 'unknown'
}

export type StartArguments = {
  /** The file's rows, each an `ImportBook` (data/import/rows.ts) with the Collections she keeps for it. */
  rows: Record<string, unknown>[]
  source: string
  /** This device's id (`deviceOf`). */
  device: string | null
  /** Rows of the file the device left out: imported before, or hers under another edition. */
  already: number
  /** The device's languages, first first (the lookups rank editions by them). */
  languages: readonly string[]
}

/** The languages the server takes (`start_import_job`): two or three letters, a region may follow; at most five. */
export function languagesOf(languages: readonly string[]): string[] {
  return languages.filter((language) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})?$/.test(language)).slice(0, 5)
}

/** Uploads the rows and starts the job; the new job's id. Never throws. */
export async function startImportJob(client: SupabaseClient, args: StartArguments): Promise<JobResult<string>> {
  try {
    const { data, error, status } = await client.rpc('start_import_job', {
      p_rows: args.rows,
      p_source: args.source,
      p_device: args.device,
      p_already: args.already,
      p_languages: languagesOf(args.languages),
    })
    if (error) return { data: null, error: errorOf(error, status) }
    return typeof data === 'string' ? { data, error: null } : { data: null, error: 'unknown' }
  } catch {
    return { data: null, error: 'offline' }
  }
}

/** Starts a new job from a failed one's own rows (`retry_import_job`): the rows without an outcome yet, as the device uploaded them. */
export async function retryImportJob(client: SupabaseClient, jobId: string): Promise<JobResult<string>> {
  try {
    const { data, error, status } = await client.rpc('retry_import_job', { p_job: jobId })
    if (error) return { data: null, error: errorOf(error, status) }
    return typeof data === 'string' ? { data, error: null } : { data: null, error: 'unknown' }
  } catch {
    return { data: null, error: 'offline' }
  }
}

/** Cancels her live job: what it wrote stays, the rows left are dropped (`cancel_import_job`). */
export async function cancelImportJob(client: SupabaseClient, jobId: string): Promise<JobResult<boolean>> {
  try {
    const { data, error, status } = await client.rpc('cancel_import_job', { p_job: jobId })
    if (error) return { data: null, error: errorOf(error, status) }
    return { data: data === true, error: null }
  } catch {
    return { data: null, error: 'offline' }
  }
}

/** Her newest job, whatever state it is in; null when she has none (or it is out of reach). The one read on every (re)connect. */
export async function latestImportJob(client: SupabaseClient): Promise<JobResult<ImportJob | null>> {
  try {
    const { data, error, status } = await client.from('import_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).limit(1)
    if (error) return { data: null, error: errorOf(error, status) }
    return { data: jobOf(data[0]), error: null }
  } catch {
    return { data: null, error: 'offline' }
  }
}

/** How many imports are in line before this job (the one running included); 0 when it has the slot or is not in the queue. */
export async function importJobAhead(client: SupabaseClient, jobId: string): Promise<JobResult<number>> {
  try {
    const { data, error, status } = await client.rpc('import_job_place', { p_job: jobId })
    if (error) return { data: null, error: errorOf(error, status) }
    const row = (Array.isArray(data) ? data[0] : data) as { state?: string; ahead?: number } | null | undefined
    return { data: row?.state === 'waiting' ? Math.max(0, Number(row.ahead) || 0) : 0, error: null }
  } catch {
    return { data: null, error: 'offline' }
  }
}

/** The entries a done job ADDED to her Library (never a book she held or had imported before): the books the Apple cover upgrade looks at. */
export async function addedEntryIds(client: SupabaseClient, jobId: string): Promise<JobResult<string[]>> {
  const ids: string[] = []
  const page = 1000
  try {
    for (let from = 0; ; from += page) {
      const { data, error, status } = await client
        .from('import_job_rows')
        .select('entry_id')
        .eq('job_id', jobId)
        .eq('outcome', 'added')
        .not('entry_id', 'is', null)
        .order('idx')
        .range(from, from + page - 1)
        .returns<{ entry_id: string }[]>()
      if (error) return { data: null, error: errorOf(error, status) }
      for (const row of data) ids.push(row.entry_id)
      if (data.length < page) return { data: ids, error: null }
    }
  } catch {
    return { data: null, error: 'offline' }
  }
}

/**
 * This DEVICE's id, made once and kept in `localStorage` (not per tab): the server stores it with the job.
 * Null when the storage refuses.
 */
export function deviceOf(storage: Pick<Storage, 'getItem' | 'setItem'> | null, make: () => string): string | null {
  const key = 'libellus.import-device'
  const valid = (value: string | null | undefined): value is string => Boolean(value && /^dev-[A-Za-z0-9-]{8,56}$/.test(value))
  try {
    const kept = storage?.getItem(key)
    if (valid(kept)) return kept
  } catch {
    return null
  }
  const device = `dev-${make()}`
  try {
    storage?.setItem(key, device)
  } catch {
    return null
  }
  return device
}

/** The jobs whose result she has seen (the pill's ×, leaving the done page): a finished job is told once, on the device. */
export const SEEN_JOBS_KEY = 'libellus.import-jobs-seen'
/** A finished job older than this is not told about when the app opens. */
export const TELL_FINISHED_DAYS = 3
const SEEN_MAX = 20

type SeenStorage = Pick<Storage, 'getItem' | 'setItem'>

function seenIds(storage: SeenStorage | null): string[] {
  try {
    const parsed = JSON.parse(storage?.getItem(SEEN_JOBS_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function hasSeen(storage: SeenStorage | null, jobId: string): boolean {
  return seenIds(storage).includes(jobId)
}

export function markSeen(storage: SeenStorage | null, jobId: string): void {
  try {
    storage?.setItem(SEEN_JOBS_KEY, JSON.stringify([...seenIds(storage).filter((id) => id !== jobId), jobId].slice(-SEEN_MAX)))
  } catch {
    // Storage refused: the result is told again next time, which is harmless.
  }
}

/** A finished job worth telling about now: ended recently and not seen yet. A live job is always shown. */
export function worthShowing(job: ImportJob, seen: (id: string) => boolean, now = Date.now()): boolean {
  if (isLive(job)) return true
  if (job.state !== 'done' && job.state !== 'failed') return false
  if (seen(job.id)) return false
  const ended = job.finishedAt ? Date.parse(job.finishedAt) : NaN
  return Number.isFinite(ended) && now - ended <= TELL_FINISHED_DAYS * 86_400_000
}
