import { useBuddyReadsSwitchStore } from '~/stores/buddyReadsSwitch'

/**
 * The buddy read screens (`/together/*`) are behind her switch (Profile → Account → Buddy reads) as well as the build's flag
 * (a page's `validate` answers the flag with the app's 404): with the switch off the address leads Home, as the entry points
 * (the Book page's row, the Home card) are not there either. Named, so only the pages that ask for it load it.
 */
export default defineNuxtRouteMiddleware(() => {
  if (!useBuddyReadsSwitchStore().enabled) return navigateTo('/', { replace: true })
})
