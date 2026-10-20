import { createPinia, setActivePinia } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PushEnvironment, PushKeys, PushPort } from '@/data/pushSubscription'

/**
 * The import page's "Notify me when it's done" (stores/importPush.ts) with the browser and the server stood in: nothing is hidden or
 * shown wrongly where Web Push is missing, the permission is asked only by `enable` (her tap, never by `check`), a refusal turns the
 * button into the "blocked" note, the choice is remembered, and turning it off is remembered too. The repository is tested against
 * the stack in tests/push-subscription.test.ts.
 */

const KEY = 'BLNU2HLFzBoPIM5lorRHGIBkthRYbR6nOlCx6wCKiMx-vhl-igE9WOuu907g0EaDBDAmRsAa0gvBr_un3DPnRkc'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

const session = reactive({ member: { id: 'ada' } as { id: string } | null })
vi.mock('~/stores/session', () => ({ useSessionStore: () => session }))
vi.mock('~/stores/locale', () => ({ useLocaleStore: () => ({ current: 'de' }) }))

const device = { items: new Map<string, string>() }
const storage = {
  getItem: (key: string) => device.items.get(key) ?? null,
  setItem: (key: string, value: string) => void device.items.set(key, value),
  removeItem: (key: string) => void device.items.delete(key),
}

let environment: PushEnvironment
let port: PushPort | null
const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: null, error: null, status: 204 }))
vi.mock('@/data/pushSubscription', async (original) => ({
  ...(await original<typeof import('@/data/pushSubscription')>()),
  browserEnvironment: () => environment,
  browserPort: () => port,
}))
vi.mock('~/data/pushSubscription', async (original) => ({
  ...(await original<typeof import('@/data/pushSubscription')>()),
  browserEnvironment: () => environment,
  browserPort: () => port,
}))

const holds: PushKeys = { endpoint: 'https://push.example.test/phone', p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }

function stand(answer: NotificationPermission, start: NotificationPermission = 'default', held: PushKeys | null = null) {
  const log = { asked: 0, unsubscribed: 0 }
  const state = { permission: start, held }
  port = {
    permission: () => state.permission,
    requestPermission: async () => {
      log.asked++
      if (state.permission === 'default') state.permission = answer
      return state.permission
    },
    subscription: async () => state.held,
    subscribe: async () => (state.held = holds),
    unsubscribe: async () => {
      log.unsubscribed++
      const gone = state.held?.endpoint ?? null
      state.held = null
      return gone
    },
  }
  return { log, state }
}

async function store(over: { key?: string; env?: Partial<PushEnvironment> } = {}) {
  environment = { userAgent: 'Chrome', serviceWorker: true, pushManager: true, notification: true, ...over.env }
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useBackend', () => ({ rpc }))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { vapidPublicKey: over.key ?? KEY } }))
  vi.stubGlobal('window', { localStorage: storage })
  session.member = { id: 'ada' }
  setActivePinia(createPinia())
  const { useImportPushStore } = await import('~/stores/importPush')
  return useImportPushStore()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  device.items.clear()
  rpc.mockClear()
  port = null
})

describe('what the page shows', () => {
  it('nothing where there is no Web Push, or the build has no key', async () => {
    stand('granted')
    const none = await store({ env: { pushManager: false } })
    await none.check()
    expect(none.view).toBe('hidden')
    const keyless = await store({ key: '' })
    await keyless.check()
    expect(keyless.view).toBe('hidden')
  })

  it('the button where it works, asking nothing yet', async () => {
    const browser = stand('granted')
    const s = await store()
    await s.check()
    expect(s.view).toBe('ask')
    expect(browser.log.asked).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('on an iPhone in a Safari tab, the way to install it', async () => {
    const browser = stand('granted')
    const s = await store({ env: { userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, pushManager: false, notification: false } })
    await s.check()
    expect(s.view).toBe('install')
    expect(browser.log.asked).toBe(0)
  })

  it('the browser\u2019s "no" is the blocked note, no button', async () => {
    stand('denied', 'denied')
    const s = await store()
    await s.check()
    expect(s.view).toBe('blocked')
  })
})

describe('her tap', () => {
  it('asks, subscribes, tells the server in her language and remembers it', async () => {
    const browser = stand('granted')
    const s = await store()
    await s.check()
    await s.enable()
    expect(browser.log.asked).toBe(1)
    expect(s.view).toBe('on')
    expect(s.said).toBe('on')
    expect(rpc).toHaveBeenCalledWith('save_push_subscription', { p_endpoint: holds.endpoint, p_p256dh: holds.p256dh, p_auth: holds.auth, p_locale: 'de' })
    expect(device.items.get('libellus.push-notify')).toBe('on')
  })

  it('a later visit shows it as on without asking again', async () => {
    stand('granted')
    const first = await store()
    await first.check()
    await first.enable()
    const browser = stand('granted', 'granted', holds)
    const again = await store()
    await again.check()
    expect(again.view).toBe('on')
    expect(browser.log.asked).toBe(0)
  })

  it('a subscription this browser holds from another member is not hers: she is offered the button', async () => {
    stand('granted', 'granted', holds)
    const s = await store()
    await s.check()
    expect(s.view).toBe('ask')
  })

  it('"no" in the browser turns the button into the blocked note and saves nothing', async () => {
    stand('denied')
    const s = await store()
    await s.check()
    await s.enable()
    expect(s.view).toBe('blocked')
    expect(rpc).not.toHaveBeenCalled()
    expect(device.items.has('libellus.push-notify')).toBe(false)
  })

  it('closing the question leaves the button; a server that does not answer says so and the button stays', async () => {
    stand('default')
    const s = await store()
    await s.check()
    await s.enable()
    expect(s.view).toBe('ask')
    expect(s.problem).toBeNull()
    stand('granted')
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'fetch failed' } as never, status: 0 })
    const offline = await store()
    await offline.check()
    await offline.enable()
    expect(offline.view).toBe('ask')
    expect(offline.problem).toBe('offline')
  })

  it('is one at a time: a second tap while the first is on its way changes nothing', async () => {
    const browser = stand('granted')
    const s = await store()
    await s.check()
    await Promise.all([s.enable(), s.enable()])
    expect(browser.log.asked).toBe(1)
  })

  it('"Turn off" ends the subscription, tells the server and forgets the choice', async () => {
    const browser = stand('granted')
    const s = await store()
    await s.check()
    await s.enable()
    await s.disable()
    expect(browser.log.unsubscribed).toBe(1)
    expect(rpc).toHaveBeenLastCalledWith('delete_push_subscription', { p_endpoint: holds.endpoint })
    expect(s.view).toBe('ask')
    expect(s.said).toBe('off')
    expect(device.items.has('libellus.push-notify')).toBe(false)
  })
})
