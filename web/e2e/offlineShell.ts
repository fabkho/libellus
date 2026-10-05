import type { Page } from '@playwright/test'

/**
 * The service worker's part in an offline flow (offline.spec.ts, offline-sync.spec.ts):
 * the dev server has no service worker, so every file of the app the page loaded
 * online is kept here and answers the same address offline; any address opens the
 * app, as the worker's navigateFallback does. Supabase is out of reach offline, as
 * on a phone. Chromium only: WebKit's driver cannot answer a page load from a
 * route while the context is offline.
 */
/** The service worker's part (see above). Returns how to go offline and back. */
export async function keepShell(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin
  type Kept = { status: number; headers: Record<string, string>; body: Buffer }
  const shell = new Map<string, Kept>()
  // Any address opens the app, as the service worker's navigateFallback does.
  let appPage: Kept | undefined
  let offline = false
  await page.route(
    (url) => url.origin === origin,
    async (route) => {
      const request = route.request()
      if (offline) {
        const kept = shell.get(request.url()) ?? (request.isNavigationRequest() ? appPage : undefined)
        return kept ? route.fulfill(kept) : route.abort('internetdisconnected')
      }
      const response = await route.fetch()
      const kept = { status: response.status(), headers: response.headers(), body: await response.body() }
      if (request.method() === 'GET') shell.set(request.url(), kept)
      if (request.isNavigationRequest()) appPage = kept
      await route.fulfill(kept)
    },
  )
  return {
    async goOffline() {
      offline = true
      await page.context().setOffline(true)
    },
    async goOnline() {
      offline = false
      await page.context().setOffline(false)
    },
  }
}
