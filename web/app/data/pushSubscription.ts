import type { SupabaseClient } from '@supabase/supabase-js'
import { isInstalled, isIos, type InstallEnvironment } from '~/utils/installHint'

/**
 * "Notify me when it's done" (Web Push for the import job; supabase/functions/import-job/README.md): the browser's permission and
 * subscription, and the one place that tells the server about it (`save_push_subscription`, `delete_push_subscription`).
 *
 * Framework-free: the browser's side comes in as a `PushPort` (the page's service worker registration and `Notification`), the
 * client from outside, so Vitest drives it in Node. Nothing here asks for the permission except `enablePush`, which the member's tap
 * calls: never on load.
 */

/** The browser's side: what `PushManager`, `Notification` and the service worker registration give. */
export type PushPort = {
  permission: () => NotificationPermission
  requestPermission: () => Promise<NotificationPermission>
  /** This browser's subscription, as `PushSubscription.toJSON()` has it; null when there is none. */
  subscription: () => Promise<PushKeys | null>
  subscribe: (applicationServerKey: Uint8Array<ArrayBuffer>) => Promise<PushKeys>
  /** Ends this browser's subscription; answers its address, or null when there was none. */
  unsubscribe: () => Promise<string | null>
}

export type PushKeys = { endpoint: string; p256dh: string; auth: string }

/** What the member sees of it: `ask` (the button), `on` (told when the import ends), `blocked` (the browser says no). */
export type PushState = 'ask' | 'on' | 'blocked'

/**
 * `unsupported`: no Web Push here (hide it). `install`: iPhone/iPad outside the Home Screen app, where Safari has none: she is told how
 * (iOS 16.4 or later, Share → Add to Home Screen). `ready`: the button.
 */
export type PushSupport = 'unsupported' | 'install' | 'ready'

/** The slice of the browser the rules read. */
export type PushEnvironment = InstallEnvironment & {
  serviceWorker: boolean
  pushManager: boolean
  notification: boolean
}

export function pushSupport(env: PushEnvironment): PushSupport {
  // Safari tabs have no PushManager at all (and before 16.4 neither has the Home Screen app): in a tab the way is to install.
  if (isIos(env) && !isInstalled(env)) return 'install'
  return env.serviceWorker && env.pushManager && env.notification ? 'ready' : 'unsupported'
}

/** The VAPID public key (base64url, 65 bytes) as `PushManager.subscribe` wants it. Null when it is not a key. */
export function applicationServerKey(publicKey: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey)) return null
  const raw = atob(publicKey.replaceAll('-', '+').replaceAll('_', '/') + '=')
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
  return bytes.length === 65 && bytes[0] === 4 ? bytes : null
}

/** Where the device remembers she agreed: a setting of this device and member (sign-out clears the `libellus.` prefix). */
export const PUSH_CHOICE_KEY = 'libellus.push-notify'

export function readPushChoice(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(PUSH_CHOICE_KEY) === 'on'
  } catch {
    return false
  }
}

export function writePushChoice(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, on: boolean) {
  try {
    if (on) storage?.setItem(PUSH_CHOICE_KEY, 'on')
    else storage?.removeItem(PUSH_CHOICE_KEY)
  } catch {
    // storage refuses: she is asked again next time
  }
}

/** Where this browser stands now: the permission and a subscription say it, not a memory of the app's. */
export async function pushState(port: PushPort): Promise<PushState> {
  const permission = port.permission()
  if (permission === 'denied') return 'blocked'
  if (permission !== 'granted') return 'ask'
  try {
    return (await port.subscription()) ? 'on' : 'ask'
  } catch {
    return 'ask'
  }
}

/** `dismissed`: she closed the browser's question without answering. */
export type EnableResult = 'on' | 'blocked' | 'dismissed' | 'unavailable' | 'failed' | 'offline'

/**
 * Her tap: asks the browser's permission (the first thing it does, while the tap is still the browser's user gesture), subscribes
 * this browser with the server's key and tells the server. Never throws.
 */
export async function enablePush(
  client: SupabaseClient,
  port: PushPort,
  options: { publicKey: string; locale: string },
): Promise<EnableResult> {
  const key = applicationServerKey(options.publicKey)
  if (!key) return 'unavailable'
  try {
    const permission = await port.requestPermission()
    if (permission === 'denied') return 'blocked'
    if (permission !== 'granted') return 'dismissed'
    const keys = (await port.subscription()) ?? (await port.subscribe(key))
    const { error, status } = await client.rpc('save_push_subscription', {
      p_endpoint: keys.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_locale: options.locale === 'de' ? 'de' : 'en',
    })
    if (error) return status === 0 ? 'offline' : 'failed'
    return 'on'
  } catch {
    // `subscribe` refused (a push service that could not be reached, a key it did not like): she can tap again.
    return 'failed'
  }
}

/** Turns it off: this browser's subscription ends, and the server forgets it. A server that cannot be reached forgets it on the next 410. */
export async function disablePush(client: SupabaseClient, port: PushPort): Promise<void> {
  let endpoint: string | null = null
  try {
    endpoint = await port.unsubscribe()
  } catch {
    return
  }
  if (!endpoint) return
  try {
    await client.rpc('delete_push_subscription', { p_endpoint: endpoint })
  } catch {
    // offline: the push service answers 410 for it next time and the sender deletes the row
  }
}

/** The browser's port: the page's service worker registration. Null where there is no Web Push. */
export function browserPort(): PushPort | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return null
  const registration = async () => (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready)
  const keysOf = (subscription: PushSubscription): PushKeys | null => {
    const json = subscription.toJSON()
    return json.endpoint && json.keys?.p256dh && json.keys.auth ? { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth } : null
  }
  return {
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    async subscription() {
      const found = await (await registration()).pushManager.getSubscription()
      return found ? keysOf(found) : null
    },
    async subscribe(applicationServerKey) {
      const made = keysOf(await (await registration()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }))
      if (!made) throw new Error('subscription_keys_missing')
      return made
    },
    async unsubscribe() {
      const found = await (await registration()).pushManager.getSubscription()
      if (!found) return null
      const endpoint = found.endpoint
      await found.unsubscribe()
      return endpoint
    },
  }
}

/** The environment of this browser, for `pushSupport`. */
export function browserEnvironment(): PushEnvironment {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean }
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: standaloneNavigator.standalone,
    displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
  }
}
