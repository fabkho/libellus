/**
 * The import job, live (proposal #329, part 5): the member's own `import_jobs` row over Supabase Realtime (a WebSocket,
 * Postgres changes; RLS select-own, the table is in the `supabase_realtime` publication, supabase/migrations/20261102010000_import_jobs.sql).
 * No polling: the server pushes, and a read on every (re)connect (`data/importJobWatch.ts`) closes the gap. The one fallback is the
 * watch's silence net: while a job is live and the socket has said nothing for 30 s, it reads once (data/importJobWatch.ts).
 *
 * The app's client is built without Realtime (`@supabase/realtime-js` is the stub, app/data/realtimeStub.ts, an alias in nuxt.config.ts:
 * ~95 KB nobody needs unless a job runs). This is the one door to the real one: `loadRealtime` imports it (`#realtime-client`, the
 * real package under another name) only when a job of hers is live, so the entry bundle does not carry it. Framework-free: the
 * module loader and the token come in from outside, so Vitest drives it with a stubbed channel.
 */

/**
 * What Realtime says of the channel's extensions (`system` messages). The join's reply (`SUBSCRIBED`) comes first; the server sets her
 * `postgres_changes` subscription up after it, and says `{ extension: 'postgres_changes', status: 'ok' }` once it is in place (about 2 s
 * later on a local stack). A change in between is never pushed. On a project whose Realtime was idle, changes may not flow even after
 * it, until the server's replication slot exists (held up by any open transaction): the watch's silence net covers that.
 */
export type FeedSystemMessage = { extension?: string; status?: string; message?: string }

/** What of a channel the feed uses (realtime-js' `RealtimeChannel`). */
export type FeedChannel = {
  on: {
    (type: 'postgres_changes', filter: { event: '*'; schema: string; table: string; filter: string }, callback: (payload: { new?: unknown }) => void): FeedChannel
    (type: 'system', filter: Record<string, never>, callback: (payload: FeedSystemMessage) => void): FeedChannel
  }
  subscribe: (callback: (status: string) => void) => FeedChannel
}

/** What of the client the feed uses (realtime-js' `RealtimeClient`). */
export type FeedClient = {
  /** Asks the `accessToken` callback and keeps the token for what is joined next. */
  setAuth: (token?: string | null) => PromiseLike<unknown>
  channel: (topic: string) => FeedChannel
  removeChannel: (channel: FeedChannel) => PromiseLike<unknown>
  disconnect: () => PromiseLike<unknown>
}

export type FeedClientOptions = { params: { apikey: string }; accessToken: () => Promise<string | null> }
export type RealtimeModule = { RealtimeClient: new (endpoint: string, options: FeedClientOptions) => FeedClient }

/** What the feed tells its owner. */
export type FeedHandlers = {
  /** The job's row, as the database now has it (a change of her own job). */
  onChange: (row: unknown) => void
  /**
   * Read the job once, so nothing in between is missed: the channel is joined (the first time and after every reconnect), and again
   * when the server says her Postgres changes are subscribed (`system`, a moment after the join: what changed in that moment is not
   * pushed; the job of the member who found this went `running` 0.6 s after the join's read, and the page stayed on "Starting soon").
   */
  onSubscribed: () => void
  /** The channel went down (the client reconnects by itself and says `onSubscribed` again). */
  onDown: () => void
}

/** An open feed: `close` ends the channel and the socket under it. */
export type OpenFeed = { close: () => void }

/** The door to the live job; tests put a stub behind it. */
export type JobFeedPort = {
  open: (memberId: string, handlers: FeedHandlers) => Promise<OpenFeed>
}

export type RealtimePortDeps = {
  /** The project's API address (`https://<ref>.supabase.co`). */
  url: string
  anonKey: string
  /** The signed-in member's access token, asked on every connect and heartbeat (the client refreshes it by itself). */
  token: () => Promise<string | null>
  /** Imports the real Realtime client: a dynamic `import()` the bundler splits into its own chunk. */
  load: () => Promise<RealtimeModule>
}

/** realtime-js' channel states that mean the channel is not delivering (it rejoins by itself). */
const DOWN = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])

/** The real thing: one socket, one channel, `postgres_changes` on her own job rows. */
export function createRealtimePort(deps: RealtimePortDeps): JobFeedPort {
  return {
    async open(memberId, handlers) {
      const { RealtimeClient } = await deps.load()
      // Realtime's address is the API's, at /realtime/v1 (the client adds /websocket and the scheme).
      const client = new RealtimeClient(`${deps.url.replace(/\/$/, '')}/realtime/v1`, { params: { apikey: deps.anonKey }, accessToken: deps.token })
      let closed = false
      // The member's token first: a channel joined before it is known joins as the anon role, which sees no job row at all
      // ("invalid column for filter"). Later refreshes come from the callback, on the client's heartbeat.
      await Promise.resolve(client.setAuth()).catch(() => {})
      const channel = client
        .channel(`import-job:${memberId}`)
        // Her rows only, twice over: the filter, and RLS (select-own) on the server.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'import_jobs', filter: `member_id=eq.${memberId}` }, (payload) => {
          if (!closed && payload.new) handlers.onChange(payload.new)
        })
        // The server's word that her changes are subscribed: what changed since the join was not pushed, read it.
        .on('system', {}, (message) => {
          if (!closed && message?.extension === 'postgres_changes' && message.status === 'ok') handlers.onSubscribed()
        })
        .subscribe((status) => {
          if (closed) return
          if (status === 'SUBSCRIBED') handlers.onSubscribed()
          else if (DOWN.has(status)) handlers.onDown()
        })
      return {
        close() {
          if (closed) return
          closed = true
          void Promise.resolve(client.removeChannel(channel))
            .catch(() => {})
            .then(() => client.disconnect())
            .catch(() => {})
        },
      }
    },
  }
}
