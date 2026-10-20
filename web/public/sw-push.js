// Web Push for the import job ("Import done", "Notify me when it's done" on /import), imported by the generated service
// worker (nuxt.config.ts, pwa.workbox.importScripts; the precache is untouched). The server sends one message when a job
// ends (supabase/functions/import-job/push.ts), encrypted for this browser; the browser decrypts it and wakes this worker:
//
//   push               shows the notification. A push that arrives without a message (or with one we cannot read) still shows
//                      one, "BetterReads": a browser that gets a push and shows nothing loses the subscription (iOS at
//                      once, Chrome after a few), so nothing is ever swallowed.
//   notificationclick  opens the app at the message's address (`/import`: the job's result and "Try again"): an open window
//                      is brought to the front and sent there, otherwise a new one opens.
//
// The address is only ever one of this app's own paths: whatever the message says, a link to another origin is never opened.
const FALLBACK_TITLE = 'BetterReads'
const FALLBACK_URL = '/import'

function ownPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return FALLBACK_URL
  return value.slice(0, 200)
}

function messageOf(event) {
  try {
    const data = event.data ? event.data.json() : null
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

self.addEventListener('push', (event) => {
  const message = messageOf(event)
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '')
  const options = {
    body: text(message.body, 200),
    icon: '/icon-192.png',
    badge: '/icon-monochrome-512.png',
    // One notification for the import: a later one replaces it instead of piling up.
    tag: text(message.tag, 40) || 'import-job',
    lang: message.lang === 'de' ? 'de' : 'en',
    data: { url: ownPath(message.url) },
  }
  event.waitUntil(self.registration.showNotification(text(message.title, 100) || FALLBACK_TITLE, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(ownPath(event.notification.data && event.notification.data.url), self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue
        try {
          await client.focus()
          // `navigate` is not in every browser's worker: then the window is only brought to the front.
          if (client.navigate && client.url !== target) await client.navigate(target)
          return
        } catch {
          // this window is gone or would not move: the next one, else a new one
        }
      }
      await self.clients.openWindow(target)
    }),
  )
})
