import { defineStore } from 'pinia'
import { readFriendsTab, visibleTabs, writeFriendsTab } from '~/utils/friendsTab'

/**
 * Whether the Friends tab is in the tab bar (utils/friendsTab.ts has the rule): on until the member
 * turns it off in Profile → Account, a setting of this device. Read from storage when the store is
 * first used (the first route middleware asks), so the first paint already has the right bar. A change
 * is stored and shown at once, no reload. Signing out puts it back to on (`reload`, after the device
 * forgot the member: stores/session.ts).
 */
export const useFriendsTabStore = defineStore('friendsTab', () => {
  const enabled = ref(import.meta.client ? readFriendsTab(window.localStorage) : true)

  /** The tabs the bar draws, in order (Search is the bar's own). */
  const tabs = computed(() => visibleTabs(enabled.value))

  function set(on: boolean) {
    enabled.value = on
    if (import.meta.client) writeFriendsTab(window.localStorage, on)
  }

  /** Reads the stored choice again: nothing stored (the device forgot the member) is on. */
  function reload() {
    enabled.value = import.meta.client ? readFriendsTab(window.localStorage) : true
  }

  return { enabled, tabs, set, reload }
})
