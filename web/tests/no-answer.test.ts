import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createCollections, type CollectionSummary } from '@/data/collections'
import { createSupabaseClient } from '@/data/createSupabaseClient'
import { createLibrary, type LibraryEntry } from '@/data/library'
import { createProbe, isNoAnswer, isTimedWrite, withWriteTimeout } from '@/data/network'
import { backoff, createOutbox, memoryOutboxStorage, type Send } from '@/data/outbox'
import type { QueuedWrite, WriteQueue } from '@/data/queuedWrites'

/**
 * A connection that answers nothing (issue #105): a write that times out or fails
 * with a network error is not an error to show, it waits in the outbox; the
 * device counts as offline for writes, and a cheap probe asks whether anything
 * answers before the outbox flushes. The backend here is a Node server that can
 * be told to hold every call without answering; nothing needs the Supabase stack.
 */

let server: Server
let url: string
const held = new Set<() => void>()
const mode = { silent: false }

beforeAll(async () => {
  server = createServer((request, response) => {
    if (mode.silent && request.url?.includes('/rest/v1/')) {
      // Never answered; released when the test ends.
      held.add(() => response.destroy())
      return
    }
    response.writeHead(request.url?.endsWith('/auth/v1/health') ? 200 : 204, { 'content-type': 'application/json' })
    response.end(request.url?.includes('/rest/v1/rpc/') ? '{}' : '')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(() => {
  mode.silent = false
  for (const release of held) release()
  held.clear()
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const ok = () => Promise.resolve(new Response('{}', { status: 200 }))
const never = (_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })

describe('what counts as a write to time out', () => {
  it('is a POST, PATCH or DELETE to the REST API, but no read, no auth call and no slow batch', () => {
    const rest = 'https://x.supabase.co/rest/v1'
    expect(isTimedWrite(`${rest}/rpc/update_progress`, { method: 'POST' })).toBe(true)
    expect(isTimedWrite(`${rest}/rpc/sync_write`, { method: 'POST' })).toBe(true)
    expect(isTimedWrite(`${rest}/library_entries?id=eq.1`, { method: 'PATCH' })).toBe(true)
    expect(isTimedWrite(`${rest}/library_entries?select=*`, { method: 'GET' })).toBe(false)
    expect(isTimedWrite(`${rest}/library_entries?select=*`, { method: 'HEAD' })).toBe(false)
    expect(isTimedWrite(`${rest}/rpc/search_books`, { method: 'POST' })).toBe(false)
    expect(isTimedWrite(`${rest}/rpc/import_books`, { method: 'POST' })).toBe(false)
    expect(isTimedWrite('https://x.supabase.co/auth/v1/token?grant_type=password', { method: 'POST' })).toBe(false)
  })

  it('is read off a Request as well as off the init', () => {
    expect(isTimedWrite(new Request('https://x.supabase.co/rest/v1/rpc/finish_reading', { method: 'POST' }))).toBe(true)
  })
})

describe('withWriteTimeout', () => {
  it('cuts a write off after the timeout and tells the watcher it got no answer', async () => {
    const seen: string[] = []
    const send = withWriteTimeout(never, 30, { onAnswer: () => seen.push('answer'), onNoAnswer: () => seen.push('none') })
    await expect(send('https://x/rest/v1/rpc/finish_reading', { method: 'POST' })).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen).toEqual(['none'])
  })

  it('tells the watcher about an answer, whatever it says', async () => {
    const seen: string[] = []
    const refuse = () => Promise.resolve(new Response('{}', { status: 400 }))
    const send = withWriteTimeout(refuse, 1000, { onAnswer: () => seen.push('answer'), onNoAnswer: () => seen.push('none') })
    expect((await send('https://x/rest/v1/rpc/finish_reading', { method: 'POST' })).status).toBe(400)
    expect(seen).toEqual(['answer'])
  })

  it('tells the watcher about a network error', async () => {
    const seen: string[] = []
    const down = () => Promise.reject(new TypeError('Failed to fetch'))
    const send = withWriteTimeout(down, 1000, { onNoAnswer: () => seen.push('none') })
    await expect(send('https://x/rest/v1/rpc/finish_reading', { method: 'POST' })).rejects.toThrow('Failed to fetch')
    expect(seen).toEqual(['none'])
  })

  it('leaves reads and other services alone, however long they take', async () => {
    const seen: string[] = []
    const slow = withWriteTimeout(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('{}')), 80)),
      20,
      { onAnswer: () => seen.push('answer'), onNoAnswer: () => seen.push('none') },
    )
    expect((await slow('https://x/rest/v1/library_entries?select=*', { method: 'GET' })).status).toBe(200)
    expect((await slow('https://x/auth/v1/otp', { method: 'POST' })).status).toBe(200)
    expect(seen).toEqual([])
  })

  it('says nothing about the connection when the caller cancels the write itself', async () => {
    const seen: string[] = []
    const send = withWriteTimeout(never, 1000, { onNoAnswer: () => seen.push('none') })
    const caller = new AbortController()
    const pending = send('https://x/rest/v1/rpc/finish_reading', { method: 'POST', signal: caller.signal })
    caller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(seen).toEqual([])
  })
})

describe('the client', () => {
  it('ends a write the backend never answers as a network failure (status 0), not a hang', async () => {
    mode.silent = true
    const seen: string[] = []
    const client = createSupabaseClient(url, 'anon', undefined, {
      writeTimeoutMs: 150,
      watch: { onNoAnswer: () => seen.push('none') },
    })
    const result = await client.rpc('update_progress', { p_entry_id: 'x' })
    expect(isNoAnswer(result)).toBe(true)
    expect(seen).toEqual(['none'])
  })

  it('still answers a write the backend takes', async () => {
    const seen: string[] = []
    const client = createSupabaseClient(url, 'anon', undefined, { writeTimeoutMs: 150, watch: { onAnswer: () => seen.push('answer') } })
    const result = await client.rpc('update_progress', { p_entry_id: 'x' })
    expect(isNoAnswer(result)).toBe(false)
    expect(seen).toEqual(['answer'])
  })
})

describe('the probe', () => {
  it('says whether anything answers', async () => {
    expect(await createProbe(url, 'anon')()).toBe(true)
    expect(await createProbe('http://127.0.0.1:9', 'anon')()).toBe(false)
  })

  it('gives up on a silence after its timeout, and on a gateway error', async () => {
    expect(await createProbe(url, 'anon', never, 30)()).toBe(false)
    expect(await createProbe(url, 'anon', () => Promise.resolve(new Response('', { status: 502 })))()).toBe(false)
    expect(await createProbe(url, 'anon', ok)()).toBe(true)
  })
})

// ------------------------------------------------------------ the repositories

/** A client whose calls got no answer, as supabase-js reports it. */
const silentClient = {
  rpc: async () => ({ data: null, error: { message: 'AbortError: aborted', code: '' }, status: 0 }),
  from: () => {
    throw new Error('not read')
  },
} as never

function entry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: 'e1',
    status: 'reading',
    book: { id: 'b1', title: 'The Dispossessed' },
    latestSession: { id: 's1', outcome: null, progressPage: 10, progressPercent: null, startedOn: '2026-01-01' },
    ...over,
  } as unknown as LibraryEntry
}

/** The outbox as the sync store lends it: `holds` follows the offline flag, which a no-answer flips. */
function lent(known: LibraryEntry) {
  const added: QueuedWrite[] = []
  const collection = { id: 'c1', name: 'Favourites', position: 0, createdAt: '', count: 0, covers: [] } as CollectionSummary
  const queue: WriteQueue = {
    holds: () => false,
    entry: (id) => (id === known.id ? known : null),
    entryForBook: (bookId) => (bookId === known.book.id ? known : null),
    collection: (id) => (id === collection.id ? collection : null),
    add: async (write) => void added.push(write),
  }
  return { added, queue }
}

describe('a write that got no answer', () => {
  it('waits in the outbox instead of failing, answering with the entry as it will be', async () => {
    const { added, queue } = lent(entry())
    const library = createLibrary(silentClient, { queue })
    const result = await library.updateProgress('e1', { page: 120 }, undefined, '2026-01-02')
    expect(result.error).toBeNull()
    expect(result.data?.latestSession?.progressPage).toBe(120)
    expect(added.map((write) => write.action)).toEqual(['update_progress'])
    expect(added[0]?.args).toMatchObject({ p_entry_id: 'e1', p_page: 120 })
  })

  it('does so for every write that can wait, a Collection change included', async () => {
    const { added, queue } = lent(entry())
    const library = createLibrary(silentClient, { queue })
    expect((await library.abandon('e1', { endedOn: '2026-01-02' })).error).toBeNull()
    expect((await library.removeFromLibrary('e1')).error).toBeNull()
    const collections = createCollections(silentClient, { queue })
    expect((await collections.rename('c1', 'Best')).error).toBeNull()
    expect((await collections.removeEntry('c1', 'e1')).error).toBeNull()
    expect((await collections.reorder('c1', ['e1'])).error).toBeNull()
    expect((await collections.delete('c1')).error).toBeNull()
    expect(added.map((write) => write.action)).toEqual([
      'abandon_reading',
      'remove_from_library',
      'rename_collection',
      'remove_from_collection',
      'reorder_collection',
      'delete_collection',
    ])
  })

  it('is refused as offline when it cannot wait (no outbox, or a write the device cannot make)', async () => {
    expect((await createLibrary(silentClient).updateProgress('e1', { page: 1 }, undefined, '2026-01-02')).error).toBe('offline')
    const { queue } = lent(entry())
    expect((await createLibrary(silentClient, { queue }).deleteSession('e1', 's1')).error).toBe('offline')
    expect((await createCollections(silentClient, { queue }).create('New')).error).toBe('offline')
  })
})

// ------------------------------------------------------------------- the outbox

describe('the outbox asks whether anything answers before it sends', () => {
  const write: QueuedWrite = { action: 'update_progress', args: { p_entry_id: 'e1' }, about: 'The Dispossessed', queuedAt: '2026-01-01T00:00:00Z' }

  it('sends nothing into a silence, and tries again after a pause that doubles', async () => {
    let sent = 0
    const send: Send = async () => (sent++, { kind: 'taken', result: {} })
    let clock = 1_000_000
    const outbox = createOutbox({ memberId: 'm', storage: memoryOutboxStorage(), send, reachable: async () => false, now: () => clock })
    await outbox.add(write)

    const first = await outbox.flush()
    expect(sent).toBe(0)
    expect(first).toMatchObject({ waiting: 1, taken: [], retryAt: clock + backoff(1) })
    clock = first.retryAt!
    expect((await outbox.flush()).retryAt).toBe(clock + backoff(2))
    expect(outbox.items()).toHaveLength(1)
    // The write itself was never tried, so it never counts a failed attempt.
    expect(outbox.items()[0]?.attempts).toBe(0)
  })

  it('sends once something answers', async () => {
    let answers = false
    const send: Send = async () => ({ kind: 'taken', result: {} })
    const outbox = createOutbox({ memberId: 'm', storage: memoryOutboxStorage(), send, reachable: async () => answers })
    await outbox.add(write)
    expect((await outbox.flush()).taken).toHaveLength(0)
    answers = true
    const report = await outbox.flush()
    expect(report).toMatchObject({ waiting: 0, retryAt: null })
    expect(report.taken).toHaveLength(1)
  })

  it('does not ask when nothing waits', async () => {
    let asked = 0
    const outbox = createOutbox({
      memberId: 'm',
      storage: memoryOutboxStorage(),
      send: async () => ({ kind: 'taken', result: {} }),
      reachable: async () => (asked++, true),
    })
    await outbox.flush()
    expect(asked).toBe(0)
  })
})
