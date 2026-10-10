/**
 * Stands in for `@supabase/realtime-js` (an alias in nuxt.config.ts and vitest.config.ts).
 *
 * supabase-js builds a Realtime client in every `SupabaseClient`, so its ~95 KB (unminified: the
 * client and the Phoenix socket under it) land in the entry chunk. The app opens no channel: its
 * data comes from PostgREST, and the realtime publication is empty. The
 * client never connects until a channel subscribes, so nothing is lost by leaving it out; this
 * keeps the call supabase-js makes on its own (`setAuth` on every auth event) and the channel
 * methods it forwards; `channel()` fails loudly instead of returning something that never fires.
 *
 * To use Realtime one day: drop the alias, and this file with it.
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
