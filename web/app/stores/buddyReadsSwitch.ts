import { defineStore } from 'pinia'
import { BUDDY_READS_DEFAULT_ON, readBuddyReads, writeBuddyReads } from '~/utils/buddyReadsSwitch'

/**
 * Whether Buddy reads are on for her (utils/buddyReadsSwitch.ts has the rule): off until she turns it on
 * in Profile → Account, a setting of this device. Read from storage when the store is first used, so the
 * first paint already knows (a screen behind it asks before it shows anything). A change is stored and
 * shown at once, no reload. Signing out puts it back to the default (`reload`, after the device forgot
 * the member: stores/session.ts).
 *
 * `canTurnOff` is a hook for the room screens (W2): while she is in an active buddy read the screens set
 * it to false, so the switch cannot claim that sharing stopped when it did not — leaving the room is what
 * stops it. The store only holds the flag; `set(false)` answers false and changes nothing while it is.
 */
export const useBuddyReadsSwitchStore = defineStore('buddyReadsSwitch', () => {
  const enabled = ref(import.meta.client ? readBuddyReads(window.localStorage) : BUDDY_READS_DEFAULT_ON)

  /** Whether the switch may be turned off right now (set by the room screens once they exist). */
  const canTurnOff = ref<boolean>(true)

  /** Turns it on or off; answers false, changing nothing, when turning it off is refused. */
  function set(on: boolean): boolean {
    if (!on && !canTurnOff.value) return false
    enabled.value = on
    if (import.meta.client) writeBuddyReads(window.localStorage, on)
    return true
  }

  /** Reads the stored choice again: nothing stored (the device forgot the member) is the default. */
  function reload() {
    enabled.value = import.meta.client ? readBuddyReads(window.localStorage) : BUDDY_READS_DEFAULT_ON
    canTurnOff.value = true
  }

  return { enabled, canTurnOff, set, reload }
})
