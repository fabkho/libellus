/**
 * Stands in for `@supabase/realtime-js` (an alias in nuxt.config.ts and vitest.config.ts).
 *
 * supabase-js builds a Realtime client in every `SupabaseClient`, so its ~95 KB (unminified: the
 * client and the Phoenix socket under it) land in the entry chunk. The app's own client opens no channel: its
 * data comes from PostgREST. The
 * client never connects until a channel subscribes, so nothing is lost by leaving it out; this
 * keeps the call supabase-js makes on its own (`setAuth` on every auth event) and the channel
 * methods it forwards; `channel()` fails loudly instead of returning something that never fires.
 *
 * The import job's live feed (#329) is the one use of Realtime: it loads the REAL client, lazily, from its own door
 * (`data/importJobFeed.ts`, `#realtime-client`, realtime.config.ts), not through this client.
 */
export class RealtimeClient {
  constructor(_endpoint?: string, _options?: unknown) {}

  setAuth(_token?: string | null): Promise<void> {
    return Promise.resolve()
  }

  channel(_name: string, _opts?: unknown): never {
    throw new Error('Realtime is not part of this build (app/data/realtimeStub.ts)')
  }

  getChannels(): never[] {
    return []
  }

  removeChannel(_channel: unknown): Promise<'ok'> {
    return Promise.resolve('ok')
  }

  removeAllChannels(): Promise<'ok'[]> {
    return Promise.resolve([])
  }
}
