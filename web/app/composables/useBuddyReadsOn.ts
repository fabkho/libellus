import { useBuddyReadsSwitchStore } from '~/stores/buddyReadsSwitch'

/**
 * Whether the buddy read screens may show and ask anything: this build has them (`NUXT_PUBLIC_BUDDY_READS`, useBuddyReadsFlag) and she turned
 * them on (Profile → Account). Every entry point (a row, a card, a sheet) checks it first; with it false nothing is drawn and no buddy RPC is called.
 * Read in a setup, not after an `await`.
 */
export function useBuddyReadsOn() {
  const store = useBuddyReadsSwitchStore()
  return computed(() => store.available && store.enabled)
}
