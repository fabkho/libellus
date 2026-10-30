/**
 * The database's side of a run: the RPCs of supabase/migrations/20261108010000_cover_store.sql, called as the service
 * role. Nothing else of the database is touched.
 */
import type { Rpc } from '../_shared/pace.ts'

/** One leased Book (`cover_store_claim`). */
export type Claimed = {
  book_id: string
  source_url: string
  attempts: number
  needs_thumbhash: boolean
  needs_colours: boolean
}

/** Why a try failed: what `cover_store_failed` takes (it books the row again, or ends it, by reason). */
export type FailReason =
  | 'throttled' | 'deleting' | 'gone' | 'unsupported_url' | 'timeout' | 'host_error' | 'not_image' | 'too_large' | 'r2_error'

export type Done = {
  book: string
  sourceUrl: string
  key: string
  widths: number[]
  bytes: number
  contentType: string
  thumbhash?: string | null
  dominant?: string | null
  secondary?: string | null
}

export type Store = {
  /** Leases up to `limit` due Books for 170 s to this runner (the id must be unique per invocation). */
  claim: (runner: string, limit: number) => Promise<Claimed[]>
  /** False while GC is deleting that key (book the row again, `deleting`). */
  reserve: (key: string) => Promise<boolean>
  /** The copy is stored (compare-and-swap): true when the Book has it, false when its cover changed or the key is being deleted. */
  done: (done: Done) => Promise<boolean>
  /** A try failed, for the runner holding the lease; false when it no longer does. */
  failed: (book: string, runner: string, reason: FailReason) => Promise<boolean>
  /** A Book this run leaves for the next (the Goodreads cap, the decode budget): queued again, due now, no attempt counted. */
  release: (book: string, runner: string) => Promise<boolean>
  /** Kicks the next run when a row is due (pg_net, from the database); answers what it did. */
  kick: () => Promise<string>
}

async function call<T>(rpc: Rpc, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data as T
}

export function createStore(rpc: Rpc): Store {
  return {
    async claim(runner, limit) {
      return (await call<Claimed[] | null>(rpc, 'cover_store_claim', { p_runner: runner, p_limit: limit })) ?? []
    },
    async reserve(key) {
      return (await call<boolean>(rpc, 'cover_store_reserve', { p_key: key })) === true
    },
    async done(done) {
      return (await call<boolean>(rpc, 'cover_store_done', {
        p_book: done.book,
        p_source_url: done.sourceUrl,
        p_key: done.key,
        p_widths: done.widths,
        p_bytes: done.bytes,
        p_content_type: done.contentType,
        p_thumbhash: done.thumbhash ?? null,
        p_dominant: done.dominant ?? null,
        p_secondary: done.secondary ?? null,
      })) === true
    },
    async failed(book, runner, reason) {
      return (await call<boolean>(rpc, 'cover_store_failed', { p_book: book, p_runner: runner, p_reason: reason })) === true
    },
    async release(book, runner) {
      return (await call<boolean>(rpc, 'cover_store_release', { p_book: book, p_runner: runner })) === true
    },
    async kick() {
      return await call<string>(rpc, 'cover_store_kick', { p_now: true })
    },
  }
}
