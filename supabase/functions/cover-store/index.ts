/**
 * The `cover-store` edge function: stores the covers of Books that are in a Library, in R2 (`libellus-covers`), at the
 * sizes the app shows (runner.ts), when the database says so (`private.cover_store_tick` kicks it). README.md says how it
 * runs, what it needs and how it is deployed. Off until the owner turns it on (`private.cover_store_settings.enabled`).
 *
 * `verify_jwt` is off (supabase/config.toml, added by the owner before the release): the function checks the caller itself
 * (handler.ts). A secret that is not set does not stop the function from starting: a run answers 503 `not_configured`
 * with the names of what is missing, so the owner sees what to set.
 *
 *   COVER_STORE_TOKEN          the bearer the database's kick carries (its Vault twin `cover_store_token`)
 *   COVER_KEY_SECRET           the HMAC key of the object keys (key.ts; changing it later is the irreversible rotation)
 *   R2_COVERS_ACCOUNT_ID, R2_COVERS_ACCESS_KEY_ID, R2_COVERS_SECRET_ACCESS_KEY    Object Read & Write on `libellus-covers` only
 *   OPENLIBRARY_CONTACT        the contact address in the User-Agent (the `openlibrary` function's secret: secrets are the project's)
 *   COVER_STORE_HOSTS          optional: which hosts are stored, comma separated (apple, openlibrary, goodreads, regal); default all
 *   R2_COVERS_ENDPOINT         optional, the local stack's stand-in for R2 only (README.md)
 */
import { createClient } from '@supabase/supabase-js'
import { sharedPace } from '../_shared/pace.ts'
import { userAgent } from '../openlibrary/client.ts'
import { createFetcher } from './fetch.ts'
import { createHandler, NotConfigured } from './handler.ts'
import { ALL_HOSTS, type HostName } from './plan.ts'
import { createR2 } from './r2.ts'
import { runCoverStore } from './runner.ts'
import { createStore } from './store.ts'

/** Open Library's keyed covers (ISBN, OCLC, LCCN) wait this long for their turn at most: a run of 8 needs ~27 s of turns. */
export const KEYED_PACE_MAX_WAIT_MS = 90_000
/** 0.3 requests a second (their limit is 100 per 5 minutes per address). */
export const KEYED_GAP_MS = 3_334
/** Covers by id are not limited; 2 a second is polite. */
export const ID_GAP_MS = 500
export const ID_PACE_MAX_WAIT_MS = 30_000

const env = (name: string) => Deno.env.get(name)?.trim() || null

const url = env('SUPABASE_URL')
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) throw new Error('cover-store needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const rpc = (name: string, args: Record<string, unknown>) => supabase.rpc(name, args)

const token = env('COVER_STORE_TOKEN')
const keySecret = env('COVER_KEY_SECRET')
const contact = env('OPENLIBRARY_CONTACT')
const r2Account = env('R2_COVERS_ACCOUNT_ID')
const r2KeyId = env('R2_COVERS_ACCESS_KEY_ID')
const r2Secret = env('R2_COVERS_SECRET_ACCESS_KEY')

const missing = Object.entries({
  COVER_KEY_SECRET: keySecret,
  OPENLIBRARY_CONTACT: contact,
  R2_COVERS_ACCOUNT_ID: r2Account,
  R2_COVERS_ACCESS_KEY_ID: r2KeyId,
  R2_COVERS_SECRET_ACCESS_KEY: r2Secret,
}).filter(([, value]) => !value).map(([name]) => name)

const named = env('COVER_STORE_HOSTS')
const hosts: HostName[] = named
  ? named.split(',').map((name) => name.trim().toLowerCase()).filter((name): name is HostName => (ALL_HOSTS as readonly string[]).includes(name))
  : [...ALL_HOSTS]

const store = createStore(rpc)
const fetcher = missing.length === 0
  ? createFetcher({
    fetch: (input, init) => fetch(input, init),
    userAgent: userAgent(contact!),
    paces: {
      keyed: sharedPace({ rpc, bucket: 'openlibrary-covers-keyed', gapMs: KEYED_GAP_MS, maxWaitMs: KEYED_PACE_MAX_WAIT_MS }),
      id: sharedPace({ rpc, bucket: 'openlibrary-covers', gapMs: ID_GAP_MS, maxWaitMs: ID_PACE_MAX_WAIT_MS }),
    },
  })
  : null
const r2 = missing.length === 0
  ? createR2({ accountId: r2Account!, accessKeyId: r2KeyId!, secretAccessKey: r2Secret!, endpoint: env('R2_COVERS_ENDPOINT') ?? undefined })
  : null

Deno.serve(createHandler({
  token,
  run() {
    if (!fetcher || !r2 || !keySecret) throw new NotConfigured(missing)
    return runCoverStore({ store, fetcher, r2, keySecret, hosts })
  },
}))
