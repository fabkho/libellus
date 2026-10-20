import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  applicationServerKey,
  disablePush,
  enablePush,
  pushState,
  pushSupport,
  readPushChoice,
  writePushChoice,
  type PushEnvironment,
  type PushKeys,
  type PushPort,
} from '@/data/pushSubscription'
import { signUpMember } from './support/member'
import { sql } from './support/stack'

/**
 * "Notify me when it's done" (data/pushSubscription.ts): where Web Push is offered (the iPhone outside the Home Screen is told how, the
 * browsers without it are not asked), the permission question that only her tap opens, what is saved on the server for her browser
 * (the real `save_push_subscription` / `delete_push_subscription` against the stack) and what is forgotten when she turns it off.
 * The browser is a stand-in `PushPort`; the sender is tested in supabase/functions/import-job.
 */

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
const env = (over: Partial<PushEnvironment> = {}): PushEnvironment => ({ userAgent: CHROME, serviceWorker: true, pushManager: true, notification: true, ...over })

// A VAPID public key and a browser's keys, the shapes the server stores (87 and 22 base64url characters).
const SERVER_KEY = 'BLNU2HLFzBoPIM5lorRHGIBkthRYbR6nOlCx6wCKiMx-vhl-igE9WOuu907g0EaDBDAmRsAa0gvBr_un3DPnRkc'
const keysOf = (seed: string): PushKeys => ({ endpoint: `https://push.example.test/${seed}-${randomUUID().slice(0, 8)}`, p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) })

/** A browser: what it has been asked and what it holds. `answer` is what the member says to the permission question. */
function browser(answer: NotificationPermission, start: NotificationPermission = 'default', held: PushKeys | null = null) {
  const log = { asked: 0, subscribed: [] as Uint8Array[], unsubscribed: 0 }
  const state = { permission: start, held }
  const port: PushPort = {
    permission: () => state.permission,
    requestPermission: async () => {
      log.asked++
      if (state.permission === 'default') state.permission = answer
      return state.permission
    },
    subscription: async () => state.held,
    subscribe: async (key) => {
      log.subscribed.push(key)
      state.held = keysOf(`sub-${log.subscribed.length}`)
      return state.held
    },
    unsubscribe: async () => {
      const gone = state.held?.endpoint ?? null
      state.held = null
      if (gone) log.unsubscribed++
      return gone
    },
  }
  return { port, log, state }
}

describe('where it is offered', () => {
  it('a browser with Web Push gets the button; one without does not', () => {
    expect(pushSupport(env())).toBe('ready')
    expect(pushSupport(env({ pushManager: false }))).toBe('unsupported')
    expect(pushSupport(env({ notification: false }))).toBe('unsupported')
    expect(pushSupport(env({ serviceWorker: false }))).toBe('unsupported')
  })

  it('an iPhone or iPad in a Safari tab is told to install the app first; the Home Screen app gets the button (iOS 16.4 or later has the API there)', () => {
    const tab = { userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 }
    expect(pushSupport(env({ ...tab, pushManager: false, notification: false }))).toBe('install')
    // even a Safari that claims the API: outside the Home Screen the subscription would not hold
    expect(pushSupport(env({ ...tab }))).toBe('install')
    expect(pushSupport(env({ ...tab, standalone: true }))).toBe('ready')
    expect(pushSupport(env({ ...tab, displayModeStandalone: true }))).toBe('ready')
    // the installed app on an iOS before 16.4 has no PushManager: nothing to offer
    expect(pushSupport(env({ ...tab, standalone: true, pushManager: false }))).toBe('unsupported')
    // an iPad that calls itself a Mac
    expect(pushSupport(env({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 }))).toBe('install')
  })

  it('the server key must be a VAPID public key (65 bytes, uncompressed) or the button does nothing', () => {
    const key = applicationServerKey(SERVER_KEY)
    expect(key).toHaveLength(65)
    expect(key![0]).toBe(4)
    expect(applicationServerKey('')).toBeNull()
    expect(applicationServerKey('short')).toBeNull()
    expect(applicationServerKey('A'.repeat(87))).toBeNull()
  })

  it('her agreement is remembered on the device, and forgotten when she turns it off', () => {
    const items = new Map<string, string>()
    const storage = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) }
    expect(readPushChoice(storage)).toBe(false)
    writePushChoice(storage, true)
    expect(readPushChoice(storage)).toBe(true)
    expect([...items.keys()].every((key) => key.startsWith('libellus.'))).toBe(true)
    writePushChoice(storage, false)
    expect(readPushChoice(storage)).toBe(false)
    expect(readPushChoice(null)).toBe(false)
  })
})

describe('where this browser stands', () => {
  it('reads the permission and the subscription, and asks nothing', async () => {
    const asking = browser('granted')
    expect(await pushState(asking.port)).toBe('ask')
    expect(await pushState(browser('granted', 'granted').port)).toBe('ask')
    expect(await pushState(browser('granted', 'granted', keysOf('x')).port)).toBe('on')
    expect(await pushState(browser('denied', 'denied').port)).toBe('blocked')
    expect(asking.log.asked).toBe(0)
  })
})

describe('her tap', () => {
  it('asks the permission, subscribes this browser with the server\u2019s key and saves it for her, in her language', async () => {
    const ada = await signUpMember()
    const phone = browser('granted')
    expect(await enablePush(ada.client, phone.port, { publicKey: SERVER_KEY, locale: 'de' })).toBe('on')
    expect(phone.log.asked).toBe(1)
    expect(phone.log.subscribed).toHaveLength(1)
    expect(Array.from(phone.log.subscribed[0]!)).toEqual(Array.from(applicationServerKey(SERVER_KEY)!))
    const saved = await ada.client.from('push_subscriptions').select('endpoint, p256dh, auth, locale, member_id')
    expect(saved.data).toEqual([{ endpoint: phone.state.held!.endpoint, p256dh: 'B'.repeat(87), auth: 'a'.repeat(22), locale: 'de', member_id: ada.id }])
  })

  it('a browser that already holds a subscription keeps it (the same address), and it becomes hers', async () => {
    const ada = await signUpMember()
    const held = keysOf('held')
    const phone = browser('granted', 'granted', held)
    expect(await enablePush(ada.client, phone.port, { publicKey: SERVER_KEY, locale: 'en' })).toBe('on')
    expect(phone.log.subscribed).toHaveLength(0)
    expect((await ada.client.from('push_subscriptions').select('endpoint')).data).toEqual([{ endpoint: held.endpoint }])
    // another member signs in on this browser and agrees: it is hers now, not Ada\u2019s
    const bo = await signUpMember()
    expect(await enablePush(bo.client, phone.port, { publicKey: SERVER_KEY, locale: 'en' })).toBe('on')
    expect((await ada.client.from('push_subscriptions').select('endpoint')).data).toEqual([])
    expect((await bo.client.from('push_subscriptions').select('endpoint')).data).toEqual([{ endpoint: held.endpoint }])
  })

  it('a refusal in the browser saves nothing; closing the question without an answer is not a refusal', async () => {
    const ada = await signUpMember()
    const no = browser('denied')
    expect(await enablePush(ada.client, no.port, { publicKey: SERVER_KEY, locale: 'en' })).toBe('blocked')
    expect(no.log.subscribed).toHaveLength(0)
    const later = browser('default')
    expect(await enablePush(ada.client, later.port, { publicKey: SERVER_KEY, locale: 'en' })).toBe('dismissed')
    expect(later.log.subscribed).toHaveLength(0)
    expect((await ada.client.from('push_subscriptions').select('endpoint')).data).toEqual([])
  })

  it('a push service that will not subscribe, or no key in the build, is a failure she can tap again, never an exception', async () => {
    const ada = await signUpMember()
    const broken = browser('granted')
    broken.port.subscribe = async () => Promise.reject(new DOMException('push service error', 'AbortError'))
    expect(await enablePush(ada.client, broken.port, { publicKey: SERVER_KEY, locale: 'en' })).toBe('failed')
    const none = browser('granted')
    expect(await enablePush(ada.client, none.port, { publicKey: '', locale: 'en' })).toBe('unavailable')
    expect(none.log.asked).toBe(0)
  })

  it('turning it off ends this browser\u2019s subscription and the server forgets it; a second time changes nothing', async () => {
    const ada = await signUpMember()
    const phone = browser('granted')
    await enablePush(ada.client, phone.port, { publicKey: SERVER_KEY, locale: 'en' })
    const endpoint = phone.state.held!.endpoint
    await disablePush(ada.client, phone.port)
    expect(phone.log.unsubscribed).toBe(1)
    expect((await ada.client.from('push_subscriptions').select('endpoint')).data).toEqual([])
    expect(await sql('select 1 from public.push_subscriptions where endpoint = $1', [endpoint])).toEqual([])
    await disablePush(ada.client, phone.port)
    expect(phone.log.unsubscribed).toBe(1)
  })
})
