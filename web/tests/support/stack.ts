import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Client as PgClient } from 'pg'
import type { SupabaseClient } from '@supabase/supabase-js'
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
export const stack = {
  url: process.env.SUPABASE_URL ?? 'http://127.0.0.1:55321',
  anonKey: process.env.SUPABASE_ANON_KEY ?? localStackValue('ANON_KEY'),
  dbUrl: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
  mailUrl: process.env.MAILPIT_URL ?? 'http://127.0.0.1:55324',
}

// ------------------------------------------------------------------ fixtures

/**
 * Every address a test invents ends in this domain, so nothing a test creates
 * can be mistaken for the developer's own data.
 */
export const TEST_DOMAIN = 'libellus.test'

/**
 * The tag of this run, set once in vitest.config.ts so the global setup and
 * every worker agree on it. Fixtures carry it and the teardown removes only
 * what carries it: two runs against one stack (a terminal and an agent, say)
 * never clean up each other's data.
 */
export const RUN_TAG = process.env.LIBELLUS_TEST_RUN ?? 'adhoc'

/** `<prefix>-<run>-<random>@libellus.test`: unique per test, findable per run. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${RUN_TAG}-${randomUUID().slice(0, 8)}@${TEST_DOMAIN}`
}

/** The pattern that matches every address this run handed out. */
export const runEmailPattern = () => `%-${RUN_TAG}-%@${TEST_DOMAIN}`

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

/**
 * Reads the six-digit code out of the mail the way a member reads it out of
 * their inbox. Delivery is asynchronous, hence the poll.
 */
export async function readMailedCode(email: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const [latest] = await mailboxFor(email)
    if (latest) {
      const response = await fetch(`${stack.mailUrl}/api/v1/message/${latest.ID}`)
      const body = (await response.json()) as { Text: string }
      const match = body.Text.match(/\b(\d{6})\b/)
      if (match) return match[1]
      throw new Error(`No six-digit code in the mail to ${email}: ${body.Text}`)
    }
    await sleep(200)
  }
  throw new Error(`No mail arrived for ${email} within ${timeoutMs}ms`)
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
