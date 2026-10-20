import { describe, expect, it } from 'vitest'
import { jobOf, type ImportJob, type JobResult } from '@/data/importJob'
import { createRealtimePort, type FeedChannel, type FeedClient, type FeedClientOptions, type FeedHandlers, type FeedSystemMessage, type JobFeedPort, type OpenFeed } from '@/data/importJobFeed'
import { createJobWatch } from '@/data/importJobWatch'
import { RealtimeClient as RealClient } from '#realtime-client'

/**
 * The live import job: the watch (data/importJobWatch.ts, what the store follows) and the Realtime adapter under it
 * (data/importJobFeed.ts), both with a stubbed channel and no network. What matters: no socket until a job is live, one read on
 * every (re)connect and none else (no polling), the changes the server pushes coalesced, the socket closed when the job ends.
 */

const row = (over: Record<string, unknown> = {}) => ({
  id: 'job-1', state: 'running', total: 100, done: 0, added: 0, kept: 0, failed: 0, already: 0,
  cover_edition: 0, cover_lent: 0, cover_openlibrary: 0, cover_goodreads: 0, cover_none: 0, error: null, finished_at: null,
  ...over,
})
const job = (over: Record<string, unknown> = {}): ImportJob => jobOf(row(over))!
const ok = <T>(data: T): JobResult<T> => ({ data, error: null })

/** A feed port that records what the watch does to it; `emit` plays the server. */
function stubPort() {
  const log = { opens: 0, closes: 0 }
  let handlers: FeedHandlers | null = null
  const port: JobFeedPort = {
    async open(_member, given) {
      log.opens++
      handlers = given
      const feed: OpenFeed = { close: () => void log.closes++ }
      return feed
    },
  }
  return {
    port,
    log,
    subscribed: () => handlers!.onSubscribed(),
    change: (over: Record<string, unknown>) => handlers!.onChange(row(over)),
  }
}

/** A watch over a database that holds `latest`, a manual clock for the throttle and everything it told. */
function setup(initial: ImportJob | null, { ahead = 0, seen = false }: { ahead?: number; seen?: boolean } = {}) {
  const feed = stubPort()
  const state = { latest: initial, reads: 0, aheads: 0, told: [] as { job: ImportJob | null; ahead: number }[] }
  const timers: { at: number; fn: () => void }[] = []
  let clock = 1_000_000
  const watch = createJobWatch({
    read: async () => {
      state.reads++
      return ok(state.latest)
    },
    ahead: async () => {
      state.aheads++
      return ok(ahead)
    },
    port: feed.port,
    member: () => 'ada',
    worth: (found) => found.state === 'queued' || found.state === 'running' || found.state === 'paused' || !seen,
    onJob: (found, place) => void state.told.push({ job: found, ahead: place }),
    throttleMs: 400,
    now: () => clock,
    after: (ms, fn) => {
      const timer = { at: clock + ms, fn }
      timers.push(timer)
      return () => void timers.splice(timers.indexOf(timer) >>> 0, 1)
    },
  })
  const tick = (ms: number) => {
    clock += ms
    for (const timer of timers.filter((one) => one.at <= clock)) {
      timers.splice(timers.indexOf(timer), 1)
      timer.fn()
    }
  }
  return { watch, feed, state, tick, last: () => state.told.at(-1) }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the first look', () => {
  it('opens no socket for a member with no job, or one that is over', async () => {
    const none = setup(null)
    await none.watch.check()
    expect(none.feed.log.opens).toBe(0)
    expect(none.last()).toEqual({ job: null, ahead: 0 })

    const done = setup(job({ state: 'done', finished_at: new Date().toISOString(), added: 5 }))
    await done.watch.check()
    expect(done.feed.log.opens).toBe(0)
    expect(done.last()?.job?.state).toBe('done')
  })

  it('does not show a finished job she has seen', async () => {
    const seen = setup(job({ state: 'done', finished_at: new Date().toISOString() }), { seen: true })
    await seen.watch.check()
    expect(seen.last()).toEqual({ job: null, ahead: 0 })
  })

  it('a live job opens the feed, once; a queued one says how many imports are ahead of it', async () => {
    const queued = setup(job({ state: 'queued' }), { ahead: 2 })
    await queued.watch.check()
    expect(queued.feed.log.opens).toBe(1)
    expect(queued.last()).toMatchObject({ ahead: 2, job: { state: 'queued' } })
    await queued.watch.check()
    expect(queued.feed.log.opens).toBe(1)
  })
})

describe('live', () => {
  it('reads once when the channel is subscribed, and again after every reconnect: that is all the reading there is', async () => {
    const now = setup(job({ done: 10 }))
    await now.watch.check()
    expect(now.state.reads).toBe(1)
    now.state.latest = job({ done: 30 })
    now.feed.subscribed()
    await settle()
    expect(now.state.reads).toBe(2)
    expect(now.last()?.job?.matched).toBe(30)
    // The connection drops and comes back: one more read, whatever happened meanwhile.
    now.state.latest = job({ done: 60 })
    now.feed.subscribed()
    await settle()
    expect(now.state.reads).toBe(3)
    expect(now.last()?.job?.matched).toBe(60)
    // Time passes while the socket talks (a running job changes once per saved row): nothing asks.
    for (let second = 0; second < 10 * 60; second += 10) {
      now.feed.change({ done: 60 + second / 10 })
      now.tick(10_000)
    }
    await settle()
    expect(now.state.reads).toBe(3)
  })

  it('the silence net: a live job and a socket that said nothing for 30 s: one read, and one more only after another 30 s of silence', async () => {
    // The page that stayed on "Starting soon" (20 October 2026): the join's read saw the job queued, the server ran it, and the socket
    // was deaf (a cold change stream waiting for its replication slot), so nothing came.
    const now = setup(job({ state: 'queued' }))
    await now.watch.check()
    now.feed.subscribed()
    await settle()
    expect(now.state.reads).toBe(2)
    now.state.latest = job({ state: 'running', done: 58 })
    now.tick(29_999)
    await settle()
    expect(now.state.reads).toBe(2)
    now.tick(1)
    await settle()
    expect(now.state.reads).toBe(3)
    expect(now.last()?.job).toMatchObject({ state: 'running', matched: 58 })
    // Still silent: another read, 30 s after the last one, and none in between.
    now.state.latest = job({ state: 'running', done: 120 })
    now.tick(15_000)
    await settle()
    expect(now.state.reads).toBe(3)
    now.tick(15_000)
    await settle()
    expect(now.state.reads).toBe(4)
    expect(now.last()?.job?.matched).toBe(120)
    // The socket speaks again: every change pushes the net back.
    now.feed.change({ done: 121 })
    now.tick(20_000)
    now.feed.change({ done: 122 })
    now.tick(20_000)
    await settle()
    expect(now.state.reads).toBe(4)
  })

  it('a read that a change overtook is not shown: the change is newer (the job ended meanwhile, and the stale read would stay)', async () => {
    const now = setup(job({ state: 'queued' }))
    await now.watch.check()
    // The read leaves while the job is queued; before it is back, the server says the job failed.
    now.feed.subscribed()
    now.feed.change({ state: 'failed', error: 'stalled', finished_at: new Date().toISOString() })
    await settle()
    expect(now.state.reads).toBe(2)
    expect(now.last()?.job?.state).toBe('failed')
    expect(now.feed.log.closes).toBe(1)
  })

  it('the silence net is off when no job is followed: the job ended, or the watch stopped', async () => {
    const ended = setup(job())
    await ended.watch.check()
    ended.feed.change({ state: 'done', done: 100, added: 100, finished_at: new Date().toISOString() })
    ended.tick(10 * 60_000)
    await settle()
    expect(ended.state.reads).toBe(1)

    const stopped = setup(job())
    await stopped.watch.check()
    stopped.watch.stop()
    stopped.tick(10 * 60_000)
    await settle()
    expect(stopped.state.reads).toBe(1)
  })

  it('coalesces the counts the server pushes: at most one a throttle, the last one wins', async () => {
    const now = setup(job({ done: 1 }))
    await now.watch.check()
    const before = now.state.told.length
    now.feed.change({ done: 2 })
    now.feed.change({ done: 3 })
    now.feed.change({ done: 4 })
    expect(now.state.told.length).toBe(before)
    now.tick(400)
    expect(now.state.told.length).toBe(before + 1)
    expect(now.last()?.job?.matched).toBe(4)
  })

  it('tells a new phase, and the end, at once', async () => {
    const now = setup(job({ state: 'queued' }), { ahead: 3 })
    await now.watch.check()
    now.feed.change({ state: 'running', done: 0 })
    expect(now.last()).toMatchObject({ ahead: 0, job: { state: 'running' } })
    now.feed.change({ state: 'running', done: 5 })
    now.feed.change({ state: 'done', done: 100, added: 90, kept: 10, finished_at: new Date().toISOString() })
    expect(now.last()?.job).toMatchObject({ state: 'done', added: 90 })
    // Nothing waits for the throttle: the pending count is dropped, the end is told.
    now.tick(1000)
    expect(now.last()?.job?.state).toBe('done')
  })

  it('closes the socket when the job ends, and opens none again for what is over', async () => {
    const now = setup(job())
    await now.watch.check()
    expect(now.feed.log).toEqual({ opens: 1, closes: 0 })
    now.feed.change({ state: 'failed', error: 'stalled', finished_at: new Date().toISOString() })
    expect(now.feed.log.closes).toBe(1)
    now.watch.nudge()
    await settle()
    expect(now.state.reads).toBe(1)
  })

  it('a job that ended while the connection was down is found by the read after the reconnect', async () => {
    const now = setup(job())
    await now.watch.check()
    now.state.latest = job({ state: 'done', added: 7, finished_at: new Date().toISOString() })
    now.feed.subscribed()
    await settle()
    expect(now.last()?.job).toMatchObject({ state: 'done', added: 7 })
    expect(now.feed.log.closes).toBe(1)
  })

  it('a job started here is followed at once (adopt), and an old job\'s last word never replaces it', async () => {
    const now = setup(null)
    await now.watch.check()
    now.state.latest = job({ id: 'job-2', state: 'queued' })
    await now.watch.adopt('job-2')
    expect(now.feed.log.opens).toBe(1)
    expect(now.last()?.job?.id).toBe('job-2')
    now.feed.change({ id: 'job-1', state: 'failed', finished_at: new Date().toISOString() })
    expect(now.last()?.job?.id).toBe('job-2')
  })

  it('coming back to the front reads once while a job is live, and never for one that is not', async () => {
    const live = setup(job())
    await live.watch.check()
    live.watch.nudge()
    await settle()
    expect(live.state.reads).toBe(2)
    const none = setup(null)
    await none.watch.check()
    none.watch.nudge()
    await settle()
    expect(none.state.reads).toBe(1)
  })

  it('stop closes the socket and tells nothing more (another member signed in)', async () => {
    const now = setup(job())
    await now.watch.check()
    now.watch.stop()
    expect(now.feed.log.closes).toBe(1)
    const told = now.state.told.length
    now.state.latest = job({ done: 50 })
    now.feed.subscribed()
    await settle()
    expect(now.state.told.length).toBe(told)
  })

  it('a socket that cannot be opened leaves the job as the read showed it', async () => {
    const watch = createJobWatch({
      read: async () => ok(job({ done: 5 })),
      ahead: async () => ok(0),
      port: { open: async () => { throw new Error('offline') } },
      member: () => 'ada',
      worth: () => true,
      onJob: () => {},
    })
    await expect(watch.check()).resolves.toBeUndefined()
    expect(watch.following).toBe(false)
  })
})

describe('the Realtime adapter', () => {
  /** realtime-js' client and channel, as far as the feed uses them. */
  function stubClient() {
    const seen = { endpoint: '', options: null as FeedClientOptions | null, topic: '', authBeforeChannel: false, filter: null as unknown, removed: 0, disconnected: 0 }
    let onChange: (payload: { new?: unknown }) => void = () => {}
    let onStatus: (status: string) => void = () => {}
    let onSystem: (message: FeedSystemMessage) => void = () => {}
    class Client implements FeedClient {
      constructor(endpoint: string, options: FeedClientOptions) {
        seen.endpoint = endpoint
        seen.options = options
      }
      async setAuth() {
        seen.authBeforeChannel = seen.topic === ''
      }
      channel(topic: string): FeedChannel {
        seen.topic = topic
        const channel: FeedChannel = {
          on(type: 'postgres_changes' | 'system', filter: unknown, callback: (payload: never) => void) {
            if (type === 'system') onSystem = callback as (message: FeedSystemMessage) => void
            else {
              seen.filter = filter
              onChange = callback as (payload: { new?: unknown }) => void
            }
            return channel
          },
          subscribe(callback) {
            onStatus = callback
            return channel
          },
        }
        return channel
      }
      async removeChannel() {
        seen.removed++
      }
      async disconnect() {
        seen.disconnected++
      }
    }
    return {
      seen,
      Client,
      change: (payload: { new?: unknown }) => onChange(payload),
      status: (status: string) => onStatus(status),
      system: (message: FeedSystemMessage) => onSystem(message),
    }
  }

  const handlers = () => {
    const log = { changes: [] as unknown[], subscribed: 0, down: 0 }
    const given: FeedHandlers = { onChange: (changed) => void log.changes.push(changed), onSubscribed: () => void log.subscribed++, onDown: () => void log.down++ }
    return { log, given }
  }

  it('loads the client when it opens (not before), listens to her own jobs only, and says "subscribed" after every (re)join', async () => {
    const stub = stubClient()
    let loads = 0
    const port = createRealtimePort({
      url: 'https://abc.supabase.co/',
      anonKey: 'anon',
      token: async () => 'jwt',
      load: async () => {
        loads++
        return { RealtimeClient: stub.Client }
      },
    })
    expect(loads).toBe(0)
    const { log, given } = handlers()
    await port.open('ada', given)
    expect(loads).toBe(1)
    expect(stub.seen.endpoint).toBe('https://abc.supabase.co/realtime/v1')
    expect(stub.seen.options?.params.apikey).toBe('anon')
    await expect(stub.seen.options?.accessToken()).resolves.toBe('jwt')
    expect(stub.seen.topic).toBe('import-job:ada')
    // The token is known before the channel joins (else it joins as the anon role and sees no job).
    expect(stub.seen.authBeforeChannel).toBe(true)
    expect(stub.seen.filter).toEqual({ event: '*', schema: 'public', table: 'import_jobs', filter: 'member_id=eq.ada' })

    stub.status('SUBSCRIBED')
    stub.status('CHANNEL_ERROR')
    stub.status('SUBSCRIBED')
    expect(log).toMatchObject({ subscribed: 2, down: 1 })
    stub.change({ new: { id: 'job-1' } })
    stub.change({})
    expect(log.changes).toEqual([{ id: 'job-1' }])
  })

  it('says "subscribed" again when the server has her Postgres changes subscribed, a moment after the join, and for nothing else it says', async () => {
    // The join's reply comes first; the server sets the subscription up after it, and a change in between is never pushed
    // (the job of 20 October 2026 went running 0.6 s after the join's read). Realtime says so: { extension, status: 'ok' }.
    const stub = stubClient()
    const port = createRealtimePort({ url: 'https://abc.supabase.co', anonKey: 'anon', token: async () => 'jwt', load: async () => ({ RealtimeClient: stub.Client }) })
    const { log, given } = handlers()
    await port.open('ada', given)
    stub.status('SUBSCRIBED')
    expect(log.subscribed).toBe(1)
    stub.system({ message: 'Subscribed to PostgreSQL', status: 'ok', extension: 'postgres_changes' })
    expect(log.subscribed).toBe(2)
    stub.system({ message: 'Subscribing to PostgreSQL failed', status: 'error', extension: 'postgres_changes' })
    stub.system({ message: 'ok', status: 'ok', extension: 'broadcast' })
    expect(log.subscribed).toBe(2)
  })

  it('close removes the channel and the socket, once, and nothing arrives after it', async () => {
    const stub = stubClient()
    const port = createRealtimePort({ url: 'https://abc.supabase.co', anonKey: 'anon', token: async () => null, load: async () => ({ RealtimeClient: stub.Client }) })
    const { log, given } = handlers()
    const open = await port.open('ada', given)
    open.close()
    open.close()
    await settle()
    expect(stub.seen).toMatchObject({ removed: 1, disconnected: 1 })
    stub.change({ new: { id: 'late' } })
    stub.status('SUBSCRIBED')
    stub.system({ status: 'ok', extension: 'postgres_changes' })
    expect(log).toMatchObject({ changes: [], subscribed: 0 })
  })

  it('the real client is the real one (the app\'s own client is built with the stub): it builds a channel and a binding without a network', () => {
    const client = new RealClient('http://127.0.0.1:1/realtime/v1', { params: { apikey: 'anon' }, accessToken: async () => null })
    const channel = client.channel('import-job:ada').on('postgres_changes', { event: '*', schema: 'public', table: 'import_jobs', filter: 'member_id=eq.ada' }, () => {})
    expect(channel.topic).toBe('realtime:import-job:ada')
    expect(client.isConnected()).toBe(false)
  })
})
