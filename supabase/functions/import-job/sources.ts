/**
 * The job's sources, wired the way the app wires them (web/app/stores/import.ts `importer`), so the job asks the same
 * questions in the same order through the same code (web/app/data: `createSearch`, `createCatalogueSearch`,
 * `createDnb`): the Catalogue first, Open Library, the National Library. The differences are where the requests go
 * out from:
 *
 * - **Open Library** directly, identified (`OPENLIBRARY_CONTACT`) and on the pace every instance and member shares
 *   (`edge_pace` bucket `openlibrary`, 3 a second: ../openlibrary/client.ts and ../_shared/pace.ts, what the
 *   `openlibrary` function does for the app);
 * - the **National Library** through its function (`dnb-lookup`) with the service role: its own pace, breaker and
 *   Catalogue writes, unchanged;
 * - the **Catalogue** as the member sees it (`import_job_search_books`, store.ts);
 * - **Apple never** (owner decision 2026-10-19: Apple's per-address limit cannot be shared by a server; its one-time
 *   upgrade runs on her device after the job, #374). Its own empty answer comes back for any Apple address, so no
 *   lookup reads a source that is off as one that refused (the import would call the row unsure and ask again): the
 *   free sources settle every row, as measured in the Apple-off assessment (PR #359).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Lookups } from '../../../web/app/data/bookImport.ts'
import { createCatalogueSearch } from '../../../web/app/data/catalogueSearch.ts'
import { createDnb, DNB_IMPORT_GAP_MS } from '../../../web/app/data/dnb.ts'
import type { FetchLike } from '../../../web/app/data/fetching.ts'
import type { FunctionsClient } from '../../../web/app/data/goodreads.ts'
import { createSearch, type Search } from '../../../web/app/data/search.ts'
import { PaceBusy } from '../_shared/pace.ts'
import type { OpenLibrary } from '../openlibrary/client.ts'

export const APPLE_HOST = 'itunes.apple.com'
export const OPENLIBRARY_HOST = 'openlibrary.org'

/** Apple's own answer for nothing found: what every Apple address gets from the job. */
export const APPLE_OFF_ANSWER = { resultCount: 0, results: [] as unknown[] }

/** The upstream `fetch` the job's other requests use (covers, mostly). */
export type UpstreamFetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

/** Resolves with `task`, or rejects at once when `signal` aborts (the task's answer is then dropped). */
function abortable<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * The `fetch` the app's sources are given (`FetchLike`): Open Library through the shared pace, Apple answered locally
 * (off), anything else as it is (with the job's User-Agent). Counts what it was asked, for the chunk's log.
 */
export function jobFetch(options: { openLibrary: OpenLibrary; fetch: UpstreamFetch; userAgent: string }) {
  const asked = { openlibrary: 0, appleOff: 0, other: 0, busy: 0 }
  const fetch: FetchLike = async (url, init) => {
    const where = new URL(url)
    if (where.hostname === APPLE_HOST) {
      asked.appleOff++
      return { ok: true, status: 200, json: () => Promise.resolve(APPLE_OFF_ANSWER), headers: { get: () => null } }
    }
    if (where.hostname === OPENLIBRARY_HOST) {
      asked.openlibrary++
      try {
        const answer = await abortable(options.openLibrary.ask(where.pathname, where.search.slice(1)), init?.signal)
        return {
          ok: answer.status >= 200 && answer.status < 300,
          status: answer.status,
          json: () => Promise.resolve(JSON.parse(answer.body)),
          text: () => Promise.resolve(answer.body),
          headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? answer.retryAfter : name.toLowerCase() === 'content-type' ? answer.contentType : null) },
        }
      } catch (error) {
        // Its turn is further away than the job waits: "busy", as the openlibrary function answers the app.
        if (error instanceof PaceBusy) {
          asked.busy++
          const seconds = String(error.retryAfterSeconds)
          return { ok: false, status: 503, json: () => Promise.resolve({}), headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? seconds : null) } }
        }
        throw error
      }
    }
    asked.other++
    return await options.fetch(url, { ...(init?.signal ? { signal: init.signal } : {}), headers: { 'user-agent': options.userAgent } })
  }
  return { fetch, asked }
}

export type JobSources = {
  lookups: Lookups
  search: Search
}

/**
 * The lookups of one chunk: `catalogueClient` answers `search_books` as the member (store.ts `memberCalls`), `functions`
 * is the service-role client's (`dnb-lookup`).
 *
 * No Goodreads lookup (`Lookups.goodreads`): Goodreads' cover of a row no source knows belongs to the cover stage,
 * which reads images.
 */
export function jobSources(options: {
  fetch: FetchLike
  languages: readonly string[]
  catalogueClient: unknown
  functions: FunctionsClient
}): JobSources {
  const catalogue = createCatalogueSearch(options.catalogueClient as SupabaseClient)
  // The National Library on the import's own budget (`purpose`) and pace (`gapMs`), as on the device.
  const dnb = createDnb(options.functions, { purpose: 'import', gapMs: DNB_IMPORT_GAP_MS })
  const search = createSearch({ fetch: options.fetch, languages: options.languages.length ? options.languages : ['de-DE', 'en-US'], catalogue, dnb })
  const lookups: Lookups = {
    catalogue,
    search,
    dnb,
    // Nothing is paced on this side that the second pass would wait out: the shared pace waits its turn itself.
    busyFor: () => 0,
  }
  return { lookups, search }
}
