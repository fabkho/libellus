import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Client as PgClient } from 'pg'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
// Relative rather than through the `@` alias: the Playwright suite will import
// these helpers too, and it resolves modules without Vitest's alias config.
import { createSupabaseClient, type SessionStorage } from '../../app/data/createSupabaseClient'

/**
 * Reads one value from `supabase status -o env`, run in the repo root. The anon
 * key is asked for rather than hardcoded, so the suite talks to whatever stack
 * this checkout started.
 */
function localStackValue(name: string): string {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
  const env = execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const match = env.match(new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm'))
  if (!match) throw new Error(`\`supabase status\` did not report ${name}. Is the stack running?`)
  return match[1]
}

/**
 * Coordinates for the local stack. The defaults are the libellus ports from
 * supabase/config.toml (553xx, so Trappist's stack on 543xx can run alongside);
 * CI sets them from `supabase status -o env`.
 */
let anonKey: string | undefined
export const stack = {
  url: process.env.SUPABASE_URL ?? 'http://127.0.0.1:55321',
  // Asked when first read, so a module that only imports this (e2e/build.ts) needs no stack up.
  get anonKey(): string {
    return (anonKey ??= process.env.SUPABASE_ANON_KEY ?? localStackValue('ANON_KEY'))
  },
  dbUrl: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
  mailUrl: process.env.MAILPIT_URL ?? 'http://127.0.0.1:55324',
}

/**
 * The stack's service-role key, asked for only by the fixtures that need what
 * no member can do (a member with a given id: the shelf's owner, e2e/shelf.spec.ts).
 */
export const serviceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? localStackValue('SERVICE_ROLE_KEY')

// ------------------------------------------------------------------ fixtures

/**
 * Every address a test invents ends in this domain, so nothing a test creates
 * can be mistaken for the developer's own data.
 */
export const TEST_DOMAIN = 'libellus.test'

/**
 * The tag of this run, set once in vitest.config.ts / playwright.config.ts so
 * the global setup, the teardown and every worker agree on it. Fixtures carry
 * it and the teardown removes only what carries it: two runs against one stack
 * (a terminal and an agent, say) never clean up each other's data.
 *
 * Read when asked, not when this module loads: the Playwright config imports
 * this module before it sets the variable, and its teardown runs in that
 * process, so a value captured at load time would be 'adhoc' there and the
 * teardown would sweep nothing.
 */
export const runTag = () => process.env.LIBELLUS_TEST_RUN ?? 'adhoc'

/** `<prefix>-<run>-<random>@libellus.test`: unique per test, findable per run. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${runTag()}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`
}

/** The pattern that matches every address this run handed out. */
export const runEmailPattern = () => `%-${runTag()}-%@${TEST_DOMAIN}`

/**
 * Catalogue Books a test makes carry this publisher and the run tag in their
 * title, so the sweep finds them (they do not hang off a member: the Catalogue
 * is shared) and never touches a real Book.
 */
export const TEST_PUBLISHER = TEST_DOMAIN

/** `<title> [<run>]`: a test Book's title, findable per run. */
export const runTitle = (title: string) => `${title} [${runTag()}]`

/** A source id no real Apple Book has: 99 and fifteen random digits. */
export function uniqueAppleId(): string {
  return `99${randomUUID().replace(/\D/g, '').padEnd(15, '0').slice(0, 15)}`
}

/**
 * Removes this run's members (their Library entries go with them) and then the
 * test Books this run put into the Catalogue, now that no Library holds them.
 */
export async function sweepRun() {
  await removePhotosOf(`u.email like $1`, [runEmailPattern()])
  await sql('delete from auth.users where email like $1', [runEmailPattern()])
  await sql(
    `delete from public.books b where b.publisher = $1 and b.title like $2
       and not exists (select 1 from public.library_entries e where e.book_id = b.id)`,
    [TEST_PUBLISHER, `% [${runTag()}]`],
  )
}

/**
 * The profile photos (#156) of the members a sweep is about to delete. Storage
 * files only go through the Storage API (a row deleted in SQL would leave the
 * file behind), so they are removed with the service-role key first.
 */
async function removePhotosOf(where: string, params: unknown[]) {
  const files = await sql<{ name: string }>(
    `select o.name from storage.objects o
       join auth.users u on (storage.foldername(o.name))[1] = u.id::text
      where o.bucket_id = 'avatars' and ${where}`,
    params,
  )
  if (!files.length) return
  const admin = createClient(stack.url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  await admin.storage.from('avatars').remove(files.map((f) => f.name))
}

/** What a crashed run left behind, once it is a day old (no run still going is). */
export async function sweepAbandonedRuns() {
  await removePhotosOf(`u.email like $1 and u.created_at < now() - interval '1 day'`, [`%@${TEST_DOMAIN}`])
  await sql(
    `delete from auth.users where email like $1 and created_at < now() - interval '1 day'`,
    [`%@${TEST_DOMAIN}`],
  )
  await sql(
    `delete from public.books b where b.publisher = $1 and b.created_at < now() - interval '1 day'
       and not exists (select 1 from public.library_entries e where e.book_id = b.id)`,
    [TEST_PUBLISHER],
  )
}

// ------------------------------------------------------------------ database

/**
 * Fixtures and checks no client is allowed to make go over SQL, as the owner
 * of the database. Assertions about what a member can do never do: they go
 * through a client signed in as that member.
 */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = new PgClient({ connectionString: stack.dbUrl })
  await db.connect()
  try {
    const result = await db.query(text, params)
    return result.rows as T[]
  } finally {
    await db.end()
  }
}

type InviteFixture = { maxUses?: number; uses?: number; expiresAt?: Date | null }

/** A fresh code per test, so nothing depends on the seed's stock being unused. */
export async function createInviteCode({
  maxUses = 1,
  uses = 0,
  expiresAt = null,
}: InviteFixture = {}): Promise<string> {
  const code = `VT${runTag()}-${randomUUID().slice(0, 8)}`.toUpperCase()
  await sql(
    `insert into public.invite_codes (code, label, max_uses, uses, expires_at)
     values ($1, 'vitest', $2, $3, $4)`,
    [code, maxUses, uses, expiresAt],
  )
  return code
}

export async function inviteCodeUses(code: string): Promise<number> {
  const rows = await sql<{ uses: number }>(
    'select uses from public.invite_codes where code = $1::citext',
    [code],
  )
  return rows[0]?.uses ?? -1
}

/** Whether GoTrue has a user on this address, confirmed or not. */
export async function authUserExists(email: string): Promise<boolean> {
  return (await sql('select 1 from auth.users where email = $1', [email])).length > 0
}

/**
 * Asked over SQL rather than through a client, because the point of the
 * question is usually that there is nobody signed in to ask it as.
 */
export async function accountExists(email: string): Promise<boolean> {
  const rows = await sql(
    'select 1 from public.accounts a join auth.users u on u.id = a.id where u.email = $1',
    [email],
  )
  return rows.length > 0
}

// ---------------------------------------------------------------- mailbox

type MailpitMessage = { ID: string; Created: string }

async function mailboxFor(email: string): Promise<MailpitMessage[]> {
  const query = encodeURIComponent(`to:${email}`)
  const response = await fetch(`${stack.mailUrl}/api/v1/search?query=${query}`)
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`)
  const body = (await response.json()) as { messages: MailpitMessage[] }
  return body.messages ?? []
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** How many mails the local mailbox holds for an address. */
export async function mailCount(email: string): Promise<number> {
  return (await mailboxFor(email)).length
}

/**
 * GoTrue refuses a second mail to the same address inside
 * `auth.email.max_frequency` (1s locally, supabase/config.toml). Tests that ask
 * for another code for an address they have just written to wait it out.
 */
export const emailCooldown = () => sleep(1_500)

/**
 * Reads the six-digit code out of the newest mail to an address the way a
 * member reads it out of their inbox. Delivery is asynchronous, hence the poll.
 * Asking for another code for the same address? Pass how many mails the box
 * should hold by then (`nth`), or the previous mail is read.
 */
export async function readMailedCode(email: string, nth = 1, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const messages = await mailboxFor(email)
    const [latest] = messages
    if (latest && messages.length >= nth) {
      const response = await fetch(`${stack.mailUrl}/api/v1/message/${latest.ID}`)
      const body = (await response.json()) as { Text: string }
      const match = body.Text.match(/\b(\d{6})\b/)
      if (match) return match[1]!
      throw new Error(`No six-digit code in the mail to ${email}: ${body.Text}`)
    }
    await sleep(200)
  }
  throw new Error(`No mail arrived for ${email} within ${timeoutMs}ms`)
}

/** Anything but the code that was sent, for the mistyped-code case. */
export function mistype(code: string): string {
  return code
    .split('')
    .map((digit) => String((Number(digit) + 1) % 10))
    .join('')
}

// ----------------------------------------------------------------- clients

/** A throwaway session store: one per client, so two members can be signed in at once. */
export function memoryStorage(): SessionStorage {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
  }
}

/** The app's client, configured exactly as the app configures it. */
export function newClient(storage: SessionStorage = memoryStorage()): SupabaseClient {
  return createSupabaseClient(stack.url, stack.anonKey, storage)
}
