import type { SupabaseClient } from '@supabase/supabase-js'
import { mapCollectionError, type CollectionErrorCode } from './collections'
import { mapLibraryError, type LibraryErrorCode } from './library'
import { LOCAL_DATABASE, openLocalDatabase } from './localData'
import { COLLECTION_ACTIONS, isLocalId, uuid, type QueuedAction, type QueuedWrite } from './queuedWrites'

/**
 * The outbox (issue #93): the writes made on this device that the database has
 * not taken yet, in the order they were made, kept on the device (IndexedDB,
 * `indexedDbOutboxStorage`) so a reload, a closed app or a dead battery does not
 * lose them.
 *
 * `flush` sends them one after another, oldest first, through `sync_write` (the
 * database applies each through the same function as the online call, at most
 * once per id: a write whose answer was lost and is sent again changes nothing).
 * What a send can come back with:
 *   - taken: the write leaves the line. The ids of the rows it made (an add's
 *     entry, a start's read) replace the device's own ids in the writes behind it.
 *   - refused (the database's rules said no: `not_reading`, `edition_in_library`
 *     …): the write leaves the line and becomes a failure the member can read
 *     and dismiss (`SyncFailure`); the store reads the Library again, which undoes
 *     what the device showed for it. The writes behind it are still sent.
 *   - unreachable (no network after all, or no answer within the write timeout,
 *     data/network.ts) or a server error: the line stops there and is tried again
 *     after a pause that doubles each time (`backoff`), in order. A server error
 *     that persists (`GIVE_UP_AFTER` tries) is a failure too.
 *
 * Before the first send a flush asks `reachable` (a cheap probe, data/network.ts)
 * whether anything answers; if not, nothing is sent (no write is held up for its
 * whole timeout) and the flush is tried again after a pause.
 *
 * Every member has their own line; signing out removes the device's outbox with
 * everything else it keeps (`localData.ts`). Framework-free: the store hands in
 * the storage, the sender and the clock, the tests an in-memory storage and a fake.
 */

export type OutboxItem = QueuedWrite & {
  /** The write's id: `sync_write`'s `p_request_id`, made once, on the device. */
  id: string
  memberId: string
  /** Sends tried so far (for the pause before the next one). */
  attempts: number
  /** Not before (epoch ms): the pause after a send that did not get through. */
  retryAt: number
}

/** A write the database refused. Kept until the member dismisses it. */
export type SyncFailure = {
  id: string
  action: QueuedAction
  about: string
  /** The database's reason, worded under `library.error.<code>` or `collections.error.<code>`. */
  code: LibraryErrorCode | CollectionErrorCode
  /** Which of the two the code belongs to. */
  domain: 'library' | 'collections'
  queuedAt: string
  failedAt: string
}

/** The device's ids that became the database's, so a write made later with one still finds its row. */
export type OutboxState = { items: OutboxItem[]; failures: SyncFailure[]; aliases: Record<string, string> }

export type OutboxStorage = {
  read: (memberId: string) => Promise<OutboxState | null>
  write: (memberId: string, state: OutboxState) => Promise<void>
}

/** What one send came back with (see above). `result`: the ids `sync_write` answered with. */
export type SendOutcome =
  | { kind: 'taken'; result: Record<string, unknown> }
  | { kind: 'refused'; code: LibraryErrorCode | CollectionErrorCode }
  | { kind: 'unreachable' }
  | { kind: 'failed'; code: LibraryErrorCode | CollectionErrorCode }

export type Send = (item: OutboxItem) => Promise<SendOutcome>

export type FlushReport = {
  taken: OutboxItem[]
  refused: SyncFailure[]
  /** Writes still waiting. */
  waiting: number
  /** When the first of them may be tried again (epoch ms), if the line stopped on it. */
  retryAt: number | null
}

/** A server error this many times in a row is a failure, not a pause. */
export const GIVE_UP_AFTER = 8
/** The longest pause between two tries. */
export const MAX_BACKOFF_MS = 5 * 60_000

/** The pause after the `attempts`-th try that did not get through: 2 s, 4 s, 8 s … up to five minutes. */
export function backoff(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(attempts, 1), MAX_BACKOFF_MS)
}

export type Outbox = {
  /** Resolves once the device's line is read. */
  ready: Promise<void>
  items: () => readonly OutboxItem[]
  failures: () => readonly SyncFailure[]
  /** Puts a write at the end of the line. The device's ids it names that already synced are the database's from here on. */
  add: (write: QueuedWrite) => Promise<OutboxItem>
  /** Sends what waits, in order (see above). One flush at a time: a second call while one runs waits for it. */
  flush: () => Promise<FlushReport>
  /** The connection is back: the pauses are over, every write may be tried at once. */
  wake: () => void
  /** Forgets a failure the member has read. */
  dismiss: (failureId: string) => Promise<void>
  /** Called after every change of the line or the failures. Returns how to stop. */
  subscribe: (listener: () => void) => () => void
  /** Stops writing to the storage (signing out deletes it; nothing may bring it back). */
  close: () => void
}

const emptyState = (): OutboxState => ({ items: [], failures: [], aliases: {} })

/** Every id in `value` that the database has given another, replaced by that one. */
function rewrite<T>(value: T, aliases: Record<string, string>): T {
  if (typeof value === 'string') return (aliases[value] ?? value) as T
  if (Array.isArray(value)) return value.map((item) => rewrite(item, aliases)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, aliases)])) as T
  }
  return value
}

export function createOutbox({
  memberId,
  storage,
  send,
  reachable,
  prepare,
  now = () => Date.now(),
}: {
  memberId: string
  storage: OutboxStorage
  send: Send
  /**
   * Gets a write ready just before its first send, when it says it is not (`coverPending`: an
   * optimistic add of a search result, whose Cover is resolved here so the tap never waited
   * for it): the arguments to send instead. A rejection sends it as it is. Left out, nothing is prepared.
   */
  prepare?: (item: OutboxItem) => Promise<Record<string, unknown>>
  /** Whether anything answers at all, asked before a flush sends. Left out, it is taken for granted. */
  reachable?: () => Promise<boolean>
  now?: () => number
}): Outbox {
  let state = emptyState()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())

  const ready = storage
    .read(memberId)
    .then((saved) => {
      if (saved) state = { items: saved.items ?? [], failures: saved.failures ?? [], aliases: saved.aliases ?? {} }
    })
    // A storage that cannot be read (private mode, a broken database) is an empty line.
    .catch(() => undefined)
    .then(notify)

  // One write to the storage at a time, each of the whole state: the last one wins.
  let saving: Promise<void> = Promise.resolve()
  let closed = false
  function persist(): Promise<void> {
    if (closed) return saving
    const snapshot: OutboxState = JSON.parse(JSON.stringify(state))
    saving = saving.then(() => storage.write(memberId, snapshot)).catch(() => undefined)
    return saving
  }

  async function add(write: QueuedWrite): Promise<OutboxItem> {
    await ready
    const item: OutboxItem = {
      ...rewrite(write, state.aliases),
      // Kept as made: a local id is replaced when its own write syncs.
      creates: write.creates,
      book: write.book,
      id: uuid(),
      memberId,
      attempts: 0,
      retryAt: 0,
    }
    state.items.push(item)
    notify()
    await persist()
    return item
  }

  function settle(item: OutboxItem, result: Record<string, unknown>) {
    for (const [name, local] of Object.entries(item.creates ?? {})) {
      const real = result[name]
      if (local && isLocalId(local) && typeof real === 'string') state.aliases[local] = real
    }
    state.items = state.items.map((waiting) => ({
      ...waiting,
      args: rewrite(waiting.args, state.aliases),
      entryId: waiting.entryId ? rewrite(waiting.entryId, state.aliases) : waiting.entryId,
    }))
  }

  function fail(item: OutboxItem, code: SyncFailure['code']): SyncFailure {
    const failure: SyncFailure = {
      id: item.id,
      action: item.action,
      about: item.about,
      code,
      domain: COLLECTION_ACTIONS.has(item.action) ? 'collections' : 'library',
      queuedAt: item.queuedAt,
      failedAt: new Date(now()).toISOString(),
    }
    state.failures.push(failure)
    return failure
  }

  /** Probes in a row that got no answer (for the pause before the next). */
  let silent = 0

  async function run(): Promise<FlushReport> {
    await ready
    const report: FlushReport = { taken: [], refused: [], waiting: 0, retryAt: null }
    if (state.items.length && reachable) {
      const answered = await reachable().catch(() => false)
      if (!answered) {
        silent += 1
        report.retryAt = now() + backoff(silent)
        report.waiting = state.items.length
        return report
      }
      silent = 0
    }
    while (state.items.length) {
      const item = state.items[0]!
      if (item.retryAt > now()) {
        report.retryAt = item.retryAt
        break
      }
      if (item.coverPending && prepare) {
        const ready = await prepare(item).catch(() => null)
        // The line may have changed meanwhile (a sign-out): only this item is touched.
        if (state.items[0]?.id !== item.id) continue
        if (ready) item.args = ready
        // Once: a send that did not get through is tried again with the Cover it has.
        item.coverPending = false
        await persist()
      }
      let outcome: SendOutcome
      try {
        outcome = await send(item)
      } catch {
        outcome = { kind: 'unreachable' }
      }
      // The line may have changed while the send was on its way (a dismiss, a sign-out): only this item moves.
      if (state.items[0]?.id !== item.id) continue
      if (outcome.kind === 'taken') {
        state.items.shift()
        settle(item, outcome.result)
        report.taken.push(item)
      } else if (outcome.kind === 'refused' || (outcome.kind === 'failed' && item.attempts + 1 >= GIVE_UP_AFTER)) {
        state.items.shift()
        report.refused.push(fail(item, outcome.code))
      } else {
        item.attempts += 1
        item.retryAt = now() + backoff(item.attempts)
        report.retryAt = item.retryAt
        notify()
        await persist()
        break
      }
      notify()
      await persist()
    }
    report.waiting = state.items.length
    return report
  }

  let flushing: Promise<FlushReport> | null = null

  return {
    ready,
    items: () => state.items,
    failures: () => state.failures,
    add,
    flush() {
      flushing ??= run().finally(() => (flushing = null))
      return flushing
    },
    wake() {
      for (const item of state.items) item.retryAt = 0
    },
    async dismiss(failureId) {
      await ready
      state.failures = state.failures.filter((failure) => failure.id !== failureId)
      notify()
      await persist()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      closed = true
      listeners.clear()
    },
  }
}

// --------------------------------------------------------------- the sender

/**
 * Sends one write through `sync_write` and says what came back (`SendOutcome`).
 * No answer at all (the fetch failed: status 0) is unreachable; a code the
 * database raised by name is a refusal; a server error, an expired session or
 * a rate limit is a failure tried again later.
 */
export function createSender(client: SupabaseClient): Send {
  return async (item) => {
    const { data, error, status } = await client.rpc('sync_write', {
      p_request_id: item.id,
      p_action: item.action,
      p_args: item.args,
    })
    if (!error) return { kind: 'taken', result: (data ?? {}) as Record<string, unknown> }
    if (!status) return { kind: 'unreachable' }
    const code = COLLECTION_ACTIONS.has(item.action) ? mapCollectionError(error) : mapLibraryError(error)
    // A rule the database named (`entry_not_found` is raised as P0002, which PostgREST answers with a 500; the
    // social ones, `set_entry_hidden`'s, as PT404, a 404) is a refusal however it is answered: sending it again is
    // refused again, and the writes behind it must not wait.
    const named = code !== 'unknown' && code !== 'not_signed_in' && status >= 500
    if (!named && (code === 'not_signed_in' || status >= 500 || status === 401 || status === 408 || status === 429)) {
      return { kind: 'failed', code: code === 'not_signed_in' ? 'unknown' : code }
    }
    return { kind: 'refused', code }
  }
}

// -------------------------------------------------------------- the storage

const STORE = 'outbox'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * The outbox in IndexedDB (the device's database, `LOCAL_DATABASE`; signing out
 * deletes it): one record per member, the whole line at once.
 * IndexedDB rather than local storage: it outlives what a browser clears under
 * pressure first, a service worker could read it, and a write is atomic.
 */
export function indexedDbOutboxStorage(factory: IDBFactory, name = LOCAL_DATABASE): OutboxStorage {
  let opened: Promise<IDBDatabase> | null = null
  function open(): Promise<IDBDatabase> {
    // Another tab deleting it (signing out there) closes this connection too.
    opened ??= openLocalDatabase(factory, { name, onClose: () => (opened = null) }).catch((error) => {
      opened = null
      throw error
    })
    return opened
  }
  return {
    async read(memberId) {
      const db = await open()
      const found = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(memberId))
      return (found as OutboxState | undefined) ?? null
    },
    async write(memberId, value) {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, memberId)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    },
  }
}

/** The outbox kept in memory only (the tests; a browser without IndexedDB). */
export function memoryOutboxStorage(): OutboxStorage & { saved: Map<string, OutboxState> } {
  const saved = new Map<string, OutboxState>()
  return {
    saved,
    async read(memberId) {
      const found = saved.get(memberId)
      return found ? JSON.parse(JSON.stringify(found)) : null
    },
    async write(memberId, value) {
      saved.set(memberId, JSON.parse(JSON.stringify(value)))
    },
  }
}
