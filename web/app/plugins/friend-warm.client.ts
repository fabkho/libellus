import { friendIdOfHref } from '~/utils/friendWarm'

/**
 * A tap (pointer down) on a link to a friend starts what her page will need while the finger is still on its way up
 * and the route resolves (composables/useFriendWarm.ts): one listener for every link to her in the app, whichever
 * screen draws it. Passive; does nothing offline.
 */
export default defineNuxtPlugin((nuxtApp) => {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const link = (event.target as Element | null)?.closest?.('a[href]')
      const id = friendIdOfHref(link?.getAttribute('href'))
      if (!id || !isOnline()) return
      // The stores exist once the app is set up; asked here, at the tap.
      nuxtApp.runWithContext(() => void useFriendWarm().warmFriend(id))
    },
    { capture: true, passive: true },
  )
})
