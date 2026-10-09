import { describe, expect, it } from 'vitest'
import { createSupabaseClient } from '@/data/createSupabaseClient'
import { RealtimeClient } from '@/data/realtimeStub'

/**
 * The build leaves Realtime out (app/data/realtimeStub.ts, an alias in nuxt.config.ts; the same
 * alias in vitest.config.ts). What supabase-js does with its Realtime client on its own, with no
 * network: a new supabase-js that starts calling something else on it fails here, not in the app.
 */
describe('a client built without Realtime', () => {
  const memory = () => {
    const items = new Map<string, string>()
    return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) }
  }

  it('is made with the stub, and answers what supabase-js asks of it', async () => {
    const client = createSupabaseClient('http://127.0.0.1:1', 'anon-key', memory())
    expect(client.realtime).toBeInstanceOf(RealtimeClient)
    await expect(client.realtime.setAuth('token')).resolves.toBeUndefined()
    expect(client.getChannels()).toEqual([])
    await expect(client.removeAllChannels()).resolves.toEqual([])
  })

  it('tells a channel is not there instead of returning one that never fires', () => {
    const client = createSupabaseClient('http://127.0.0.1:1', 'anon-key', memory())
    expect(() => client.channel('anything')).toThrow(/Realtime is not part of this build/)
  })

  it('still signs out through the auth events that reach Realtime', async () => {
    const client = createSupabaseClient('http://127.0.0.1:1', 'anon-key', memory())
    const events: string[] = []
    client.auth.onAuthStateChange((event) => void events.push(event))
    await client.auth.signOut({ scope: 'local' })
    expect(events).toContain('SIGNED_OUT')
  })
})
