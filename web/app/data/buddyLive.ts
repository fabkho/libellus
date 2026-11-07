import {
  createLiveConnection,
  type ChannelLike,
  type LiveConnection,
  type LiveEnv,
  type LiveState,
  type RealtimeLike,
  type ResyncEvent,
  type TopicChannel,
  type TopicHandlers,
  subscribeTopic,
} from '#layers/chat/app/utils/liveChannel'
import { messageFromJson, type BuddyMessage } from './buddyReads'

/**
 * Buddy reads, live (docs/plans/buddy-read-shared.md part 4.4; the database side: supabase/migrations/20261113040000_buddy_read_realtime.sql).
 * The database tells a member's open devices that something in her reads changed over Supabase Realtime Broadcast: one private channel
 * per member, topic `member:<her id>`, only the database sends. This module is the app's side of it: the layer's `subscribeTopic` and
 * `createLiveConnection` (`@fabkho/chat`, utils/liveChannel.ts; it imports no Realtime library) over a `RealtimeLike` built from the
 * real Realtime client, which is loaded **lazily**: the app's client is built with `@supabase/realtime-js` aliased to a stub
 * (app/data/realtimeStub.ts), and the one door to the real one is `load` (`() => import('#realtime-client')`, the way
 * data/importJobFeed.ts builds its client), so the entry bundle never carries it (entry-guard.config.ts fails a build that does).
 *
 * Nothing here is started by importing it: a screen of a buddy read `retain`s the connection and `release`s it when it closes (a short
 * grace, so going from the room to a thread does not tear the socket down), the last release closes the channel and the socket: one
 * connection per device, only while a buddy read screen needs it (the Free plan allows 200 at once). The Home card reads
 * `my_buddy_reads()` on focus instead. Framework-free: the module loader, the token and the page's events come in from outside, so
 * Vitest drives it against the real client on the stack or a stub.
 *
 * Broadcast delivers while a device is connected; the tables stay the source of truth: on a rejoin, a revived socket or the first
 * seconds after a join (`resync`) the app reads what it missed through the RPCs.
 */

// ------------------------------------------------------------------ events

/** What the database broadcasts, as the app takes it. No payload carries a page, a figure or a Section number of a member. */
export type BuddyLiveEvent =
  /** `message.new`: the message row (no author name, no reactions: they are not in the payload). */
  | { type: 'message'; message: BuddyMessage }
  /** `message.deleted`: it became a tombstone. */
  | { type: 'deleted'; messageId: string; readId: string; sectionId: string | null }
  /** `message.reaction`: `memberId`'s reaction on the message is now `emoji`, null when she took it back. */
  | { type: 'reaction'; messageId: string; readId: string; memberId: string; emoji: string | null }
  /** `buddy_read.changed`: read `buddy_read(readId)` again (a member, a role, a Section, the status). */
  | { type: 'changed'; readId: string }
  /** `buddy.invitation`: read `my_buddy_reads()` again (an invitation came or went). */
  | { type: 'invitation'; readId: string }

type Json = Record<string, unknown>
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

/**
 * The event of a broadcast, or null for one this app does not know (dropped). Defensive on purpose: a payload of another shape
 * is a bug on the server's side, never an exception in the socket's callback. `realtime.send` adds an `id` of its own (the
 * broadcast's) to a payload that has none, so `buddy_read.changed` is read by `buddy_read_id` only.
 */
export function parseBuddyEvent(event: string, payload: unknown): BuddyLiveEvent | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Json
  const readId = text(p.buddy_read_id)
  switch (event) {
    case 'message.new': {
      const id = text(p.id)
      const createdAt = text(p.created_at)
      if (!id || !readId || !createdAt) return null
      return {
        type: 'message',
        message: messageFromJson(readId, {
          id,
          section_id: text(p.section_id),
          author: { id: text(p.author_id), name: null },
          client_id: text(p.client_id),
          kind: text(p.kind) ?? 'text',
          body: typeof p.body === 'string' ? p.body : '',
          media_url: text(p.media_url),
          media_width: typeof p.media_width === 'number' ? p.media_width : null,
          media_height: typeof p.media_height === 'number' ? p.media_height : null,
          // A voice message: its type, length and waveform; no object name, which the app works out from the ids above (data/buddyVoice.ts).
          voice: p.voice && typeof p.voice === 'object' ? (p.voice as { mime?: string; duration_ms?: number; peaks?: number[] }) : null,
          reply_to: text(p.reply_to),
          created_at: createdAt,
          deleted_at: null,
          reactions: [],
        }),
      }
    }
    case 'message.deleted': {
      const messageId = text(p.id)
      return messageId && readId ? { type: 'deleted', messageId, readId, sectionId: text(p.section_id) } : null
    }
    case 'message.reaction': {
      const messageId = text(p.message_id)
      const memberId = text(p.member_id)
      return messageId && readId && memberId ? { type: 'reaction', messageId, readId, memberId, emoji: text(p.emoji) } : null
    }
    case 'buddy_read.changed':
      return readId ? { type: 'changed', readId } : null
    case 'buddy.invitation':
      return readId ? { type: 'invitation', readId } : null
    default:
      return null
  }
}

/** The topic of a member: the database's `private.member_topic`, the one channel she may join. */
export const memberTopic = (memberId: string): string => `member:${memberId}`

// ------------------------------------------------------------------ the lazy client

/** What the live module uses of realtime-js' channel (`broadcast` and the join's state). */
type RealChannel = ChannelLike
/** What it uses of the client (realtime-js' `RealtimeClient`). */
export type LiveClient = {
  setAuth: (token?: string | null) => PromiseLike<unknown>
  channel: (topic: string, opts: { config: { private: boolean } }) => RealChannel
  removeChannel: (channel: RealChannel) => PromiseLike<unknown>
  disconnect: () => PromiseLike<unknown>
}
export type LiveClientOptions = { params: { apikey: string }; accessToken: () => Promise<string | null> }
export type LiveRealtimeModule = { RealtimeClient: new (endpoint: string, options: LiveClientOptions) => LiveClient }

export type LazyRealtimeDeps = {
  /** The project's API address (`https://<ref>.supabase.co`). */
  url: string
  anonKey: string
  /** The signed-in member's access token, asked on every connect and heartbeat. */
  token: () => Promise<string | null>
  /** Imports the real Realtime client: `() => import('#realtime-client')`, which the bundler splits into its own chunk. */
  load: () => Promise<LiveRealtimeModule>
}

/**
 * The layer's `RealtimeLike` over the real client, which is imported and built on the first `setAuth` (the layer awaits it before it
 * asks for a channel, so `channel` finds the client there). `close` removes the socket and forgets the client: the next join builds a
 * new one. Nothing is loaded until `setAuth` is called.
 */
export function createLazyRealtime(deps: LazyRealtimeDeps) {
  let client: LiveClient | null = null
  let building: Promise<LiveClient> | null = null

  function build(): Promise<LiveClient> {
    building ??= deps
      .load()
      .then((module) => {
        // Realtime's address is the API's, at /realtime/v1 (the client adds /websocket and the scheme).
        client = new module.RealtimeClient(`${deps.url.replace(/\/$/, '')}/realtime/v1`, { params: { apikey: deps.anonKey }, accessToken: deps.token })
        return client
      })
      // The chunk is not precached: a start while offline rejects, and a rejected promise kept here would fail every later start too.
      .catch((error) => {
        building = null
        throw error
      })
    return building
  }

  const realtime: RealtimeLike = {
    // The member's token first: a private channel joined before it is known joins as the anon role and is refused.
    async setAuth() {
      const ready = await build()
      await ready.setAuth()
    },
    channel(topic, opts) {
      if (!client) throw new Error('The Realtime client is not loaded yet')
      return client.channel(topic, opts)
    },
    async removeChannel(channel) {
      await client?.removeChannel(channel)
    },
  }

  return {
    realtime,
    /** Whether the real client has been loaded (the entry never does: the test of "no Realtime request until a screen asks"). */
    get loaded() {
      return client !== null
    },
    /** Closes the socket and drops the client. */
    async close() {
      const open = client
      client = null
      building = null
      if (open) await Promise.resolve(open.disconnect()).catch(() => {})
    },
  }
}

// ------------------------------------------------------------------ the connection

/** The layer's `LiveEnv`, and the way to take its page listeners off again (the layer never does). */
export type LiveEnvWithDispose = LiveEnv & { dispose?: () => void }

export type BuddyLiveDeps = LazyRealtimeDeps & {
  /** The page's network word and lifecycle events (`browserLiveEnv`). */
  env: LiveEnvWithDispose
  now?: () => number
  /** How long the last release waits before the channel closes (a screen change in between keeps it). Default 5 s. */
  graceMs?: number
  /** Called when the connection's status, member or network word changes. */
  onChange?: (state: LiveState) => void
  /** How long a channel may be joining before it counts as stuck (the Free plan's 200 connections give no other signal). Default 30 s. */
  stuckMs?: number
  /** The channel has not been live for `stuckMs` (true: the screens say live updates are paused, and the app reads what it missed on its own), or is live again (false). */
  onStuck?: (stuck: boolean) => void
  timers?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void }
}

export type BuddyLive = {
  /**
   * A screen needs the live channel for `memberId`: starts it when it is not up. Returns the function that lets it go; the channel
   * closes `graceMs` after the last one has.
   */
  retain: (memberId: string) => () => void
  /** Listens to one kind of event (`resync` included); returns the function that stops. */
  on: LiveConnection<BuddyLiveEvent>['on']
  /** Closes the channel and the socket now (sign-out, another member). */
  stop: () => Promise<void>
  /** `stop`, and the page's listeners come off: this connection is not used again. */
  dispose: () => Promise<void>
  readonly status: LiveConnection<BuddyLiveEvent>['status']
  readonly memberId: string | null
  readonly retained: number
  /** Whether the real client has been loaded. */
  readonly loaded: boolean
}

export type { ResyncEvent }

/** The live connection of the app: the layer's, opened on `member:<id>` over the lazy client. */
export function createBuddyLive(deps: BuddyLiveDeps): BuddyLive {
  const lazy = createLazyRealtime(deps)
  const timers = deps.timers ?? { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>) }
  const grace = deps.graceMs ?? 5_000
  const stuckMs = deps.stuckMs ?? 30_000

  let holders = 0
  let timer: unknown = null
  /** A stop and a start may overlap: each waits for the one before, and one failing does not stop the next. */
  let chain: Promise<void> = Promise.resolve()
  const queued = (step: () => Promise<void> | void): Promise<void> => (chain = chain.then(step).catch(() => {}))

  // The join gives no word when the server will not take it (the Free plan's 200 connections): it just never goes live. A channel that has not
  // been live for `stuckMs` is called stuck, once, and joined again from the start every `stuckMs` until it is live (this also frees the layer's
  // revival, which waits for a join that never comes).
  let stuckTimer: unknown = null
  let stuck = false
  const setStuck = (next: boolean) => {
    if (stuck === next) return
    stuck = next
    deps.onStuck?.(next)
  }
  const disarm = () => {
    if (stuckTimer) timers.clearTimeout(stuckTimer)
    stuckTimer = null
  }
  const arm = () => {
    if (stuckTimer || holders === 0) return
    stuckTimer = timers.setTimeout(() => {
      stuckTimer = null
      const id = connection.memberId
      if (holders === 0 || !id) return
      setStuck(true)
      void queued(async () => {
        await connection.stop()
        await lazy.close()
        if (holders > 0) await connection.start(id)
      })
      arm()
    }, stuckMs)
  }

  const connection = createLiveConnection<BuddyLiveEvent>({
    open: (id: string, handlers: TopicHandlers<BuddyLiveEvent>): TopicChannel => subscribeTopic(lazy.realtime, memberTopic(id), parseBuddyEvent, handlers),
    now: deps.now ?? (() => Date.now()),
    env: deps.env,
    onChange: (state) => {
      deps.onChange?.(state)
      if (state.status === 'live') {
        disarm()
        setStuck(false)
      } else if (state.status !== 'idle') arm()
    },
  })

  function closeNow(): Promise<void> {
    disarm()
    setStuck(false)
    return queued(async () => {
      await connection.stop()
      await lazy.close()
    })
  }

  return {
    retain(memberId) {
      if (timer) {
        timers.clearTimeout(timer)
        timer = null
      }
      holders++
      // Another member than the channel's: that one's is closed first.
      if (connection.memberId && connection.memberId !== memberId) void closeNow()
      void queued(() => (holders > 0 ? connection.start(memberId) : undefined))
      let released = false
      return () => {
        if (released) return
        released = true
        holders = Math.max(0, holders - 1)
        if (holders > 0) return
        timer = timers.setTimeout(() => {
          timer = null
          if (holders === 0) void closeNow()
        }, grace)
      }
    },
    on: connection.on,
    async stop() {
      if (timer) timers.clearTimeout(timer)
      timer = null
      holders = 0
      await closeNow()
    },
    async dispose() {
      if (timer) timers.clearTimeout(timer)
      timer = null
      holders = 0
      await closeNow()
      deps.env.dispose?.()
    },
    get status() {
      return connection.status
    },
    get memberId() {
      return connection.memberId
    },
    get retained() {
      return holders
    },
    get loaded() {
      return lazy.loaded
    },
  }
}

// ------------------------------------------------------------------ the page

/** What of the page the environment needs (`window` and `document` fit). */
export type LivePage = {
  navigator: { onLine: boolean }
  document: { visibilityState: string; addEventListener: (type: string, fn: () => void) => void; removeEventListener?: (type: string, fn: () => void) => void }
  addEventListener: (type: string, fn: () => void) => void
  removeEventListener?: (type: string, fn: () => void) => void
}

/** The layer's `LiveEnv` over the page: the device's network word, the page going hidden and coming back. */
export function browserLiveEnv(page: LivePage): LiveEnvWithDispose {
  const attached: Array<[string, () => void, 'page' | 'document']> = []
  const on = (target: 'page' | 'document', type: string, fn: () => void) => {
    ;(target === 'page' ? page : page.document).addEventListener(type, fn)
    attached.push([type, fn, target])
  }
  return {
    isOnline: () => page.navigator.onLine,
    listen(handlers) {
      on('page', 'online', handlers.online)
      on('page', 'offline', handlers.offline)
      on('document', 'visibilitychange', () => (page.document.visibilityState === 'hidden' ? handlers.hidden() : handlers.visible()))
    },
    dispose() {
      for (const [type, fn, target] of attached.splice(0)) (target === 'page' ? page : page.document).removeEventListener?.(type, fn)
    },
  }
}
