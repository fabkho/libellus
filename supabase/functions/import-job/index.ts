/**
 * The `import-job` edge function: one chunk of the import job holding the import queue's slot (runner.ts), its rows
 * matched by work.ts with the app's own import code (web/app/data), through the sources of sources.ts. README.md says how it runs, chains and is deployed.
 *
 * `verify_jwt` is off (supabase/config.toml): the function checks the caller itself. The database's kick carries the
 * `IMPORT_JOB_TOKEN` secret (the Vault's `import_job_token`); the service-role key passes too (a run by hand).
 * `OPENLIBRARY_CONTACT` (the `openlibrary` function's secret: secrets are the project's) identifies the job to Open
 * Library, as the app's requests through the `openlibrary` function are.
 */
import { createClient } from '@supabase/supabase-js'
import type { FunctionsClient } from '../../../web/app/data/goodreads.ts'
import { sharedPace } from '../_shared/pace.ts'
import { createOpenLibrary, MIN_INTERVAL_MS, userAgent } from '../openlibrary/client.ts'
import { createHandler } from './handler.ts'
import { runChunk } from './runner.ts'
import { sameSecret } from './secret.ts'
import { jobFetch, jobSources } from './sources.ts'
import { createStore, memberCalls } from './store.ts'
import { createWork } from './work.ts'

/** The longest a job's Open Library request waits for its turn (the app's own wait is 4 s: the job is in no hurry). */
export const JOB_PACE_MAX_WAIT_MS = 10_000

const url = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('import-job needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
const contact = Deno.env.get('OPENLIBRARY_CONTACT')?.trim()
if (!contact) throw new Error('import-job needs OPENLIBRARY_CONTACT (the contact address Open Library is given)')
const jobToken = Deno.env.get('IMPORT_JOB_TOKEN')?.trim() || null

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const rpc = (name: string, args: Record<string, unknown>) => supabase.rpc(name, args)
// The app's data layer takes the slice of the client it calls (`functions.invoke`).
const functions = supabase as unknown as FunctionsClient
const agent = userAgent(contact)

// One pace for every instance and member (a turn booked in Postgres), shared with the `openlibrary` function.
const openLibrary = createOpenLibrary({
  fetch: (input, init) => fetch(input, init),
  userAgent: agent,
  pace: sharedPace({ rpc, bucket: 'openlibrary', gapMs: MIN_INTERVAL_MS, maxWaitMs: JOB_PACE_MAX_WAIT_MS }),
})
const upstream = (input: string, init?: RequestInit) => fetch(input, init)
const { fetch: sourcesFetch } = jobFetch({ openLibrary, fetch: upstream, userAgent: agent })

const work = createWork({
  lookups(job, runner) {
    const member = memberCalls(rpc, job.id, runner, (name, args) => supabase.rpc(name, args))
    return jobSources({
      fetch: sourcesFetch,
      languages: job.languages,
      catalogueClient: member.catalogueClient,
      functions,
    }).lookups
  },
})
const store = createStore(rpc)

Deno.serve(createHandler({
  async authorize(token) {
    if (await sameSecret(token, serviceKey)) return true
    return jobToken !== null && (await sameSecret(token, jobToken))
  },
  run: () => runChunk({ store, work, runner: `fn:${crypto.randomUUID()}` }),
}))
