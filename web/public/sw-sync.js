// Background Sync for the outbox (issue #93), imported by the generated service
// worker (nuxt.config.ts, pwa.workbox.importScripts). The app registers the tag
// `libellus-outbox` when a write waits (stores/sync.ts); where the browser has
// Background Sync (Chrome, Android) it fires `sync` once the connection is back,
// even while the app sits in the background. The writes need the member's
// session, which only the app holds, so the worker does not send them itself: it
// tells every open window to sync now. With no window open nothing is lost; the
// app sends the outbox the next time it starts.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'libellus-outbox') return
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'libellus:sync' })
    }),
  )
})
