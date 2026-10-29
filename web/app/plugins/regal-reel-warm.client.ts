import { prefetchBothReadReel, saveDataOn, slowDevice } from '~/utils/bothReadReel'
import { onIdle } from '~/utils/idle'

/**
 * Keeps the reel chunk on the device across releases, for the members who use it (docs: parity.md, "You both read").
 *
 * The chunk (`regal-reel`, 1.2 MB raw, ~285 KB br, and the 22 KB `regal-preload` it imports from) is NOT in the service
 * worker's precache (nuxt.config.ts, `globIgnores`): the precache is fetched at every install and update by every
 * member, the first one blocking the new worker's activation, and most members never open a friend's page or the shelf
 * (the shelf's own measurements say a member who does not fetches nothing of Regal). It is kept by a runtime rule
 * instead (`libellus-shelf-code`, cache first: the names carry their hash). That leaves the first visit after each
 * update downloading the new chunk when the friend's page opens. This warms it in the background after an update: once
 * the worker controls the page and the browser is idle, a member whose `libellus-shelf-code` cache already holds an
 * earlier `regal-reel` (she has used the reel or the shelf on this device) asks for the current one, which the worker's
 * rule fetches and keeps. Not on Save-Data, not on a 2g connection or a phone with 2 GB of memory or less, not offline, nothing for a member who never used it, and nothing when the
 * current chunk is already kept (the worker answers from the cache).
 */
export default defineNuxtPlugin(() => {
  if (useAppConfig().regal !== true || !('serviceWorker' in navigator) || !('caches' in window)) return

  async function warm() {
    if (saveDataOn() || slowDevice() || !navigator.onLine) return
    if (!(await caches.has('libellus-shelf-code'))) return
    const cache = await caches.open('libellus-shelf-code')
    const used = (await cache.keys()).some((request) => /\/_nuxt\/regal-reel\.[^/]+\.js$/.test(new URL(request.url).pathname))
    if (used) prefetchBothReadReel(true, { background: true })
  }

  void navigator.serviceWorker.ready.then(() => {
    // The first load after an install is not controlled yet: the rule only sees what a controlled page fetches.
    const go = () => onIdle(() => void warm().catch(() => undefined), { timeout: 8000, fallback: 4000 })
    if (navigator.serviceWorker.controller) go()
    else navigator.serviceWorker.addEventListener('controllerchange', go, { once: true })
  })
})
