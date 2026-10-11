import { useFriendsTabStore } from '~/stores/friendsTab'

/**
 * The Friends feed is one page that is a tab or a pushed screen, by the member's setting (Profile →
 * Account → Friends tab, utils/friendsTab.ts). The page names itself with `tab: 'friends'`; this says,
 * for each visit, what it is: a tab page (kept alive, with the header and its place) while the tab is
 * on, the pushed screen it was before the tab (`pushed`, its own top bar and Back) while it is off.
 * `to.meta` is the visit's own copy, so a change of the setting reaches the next visit, and a deep
 * link or a reload on /friends with the tab off shows the pushed screen.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (to.meta.tab !== 'friends') return
  const on = useFriendsTabStore().enabled
  to.meta.pushed = !on
  to.meta.keepalive = on
})
