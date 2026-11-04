import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { BuddyErrorCode } from '~/data/buddyReads'
import { useBuddyReadStore } from '~/stores/buddyRead'
import { useBuddyInvitesStore } from '~/stores/buddyInvites'
import { useBuddyReadsSwitchStore } from '~/stores/buddyReadsSwitch'
import { inRoomsHint, leaveAndDecline, needsLeaving, turnOffPlan, turnOffView } from '~/utils/buddyTurnOff'

/**
 * Turning Buddy reads off (Profile → Account; utils/buddyTurnOff.ts has the rules). The switch only hides the entry points: a room she is in
 * keeps showing her Section, so turning it off with a room (or an invitation) is a question: "Leave your buddy reads and turn off?". It is
 * asked only by the Profile, which imports the big store anyway (the shell never imports this one: tests/buddy-read-entry.test.ts).
 *
 * - `request` is her flip to off. It reads `my_buddy_reads()` fresh first (a room she joined on another device counts; offline, or a refusal,
 *   it cannot know: the switch stays on and says so, `checkError`), then either turns it off at once (no room, no invitation) or opens the
 *   confirm (`asking`).
 * - `confirm` leaves her rooms in order (`deleteMessages` goes to each: unticked, her messages stay in the room; the choice is made now and
 *   cannot be changed later), declines the invitations, and only then turns the switch off. The first refusal stops it, is kept in `error`
 *   for the confirm to word, and the rooms already left stay left: the next try only has the rest.
 * - Nothing here is called with the build flag off or the switch off, except `refresh` for the hint, which the Profile asks only while it is on.
 */
export const useBuddyTurnOffStore = defineStore('buddyTurnOff', () => {
  const buddy = useBuddyReadStore()
  const switchStore = useBuddyReadsSwitchStore()
  const invites = useBuddyInvitesStore()

  /** The confirm is open. */
  const asking = ref(false)
  /** The list is being read (after the flip) or the leaving runs. */
  const checking = ref(false)
  const busy = ref(false)
  /** "Also delete my messages": unticked every time the confirm opens. */
  const deleteMessages = ref(false)
  /** The refusal of the last leave or decline, for the confirm. */
  const error = ref<BuddyErrorCode | null>(null)
  /** The list could not be read after the flip: the switch stays on. */
  const checkError = ref<BuddyErrorCode | null>(null)

  const plan = computed(() => turnOffPlan(buddy.mine))
  const view = computed(() => turnOffView(plan.value))
  /** "You're in 2 buddy reads" under the row, null while she is in none. */
  const hint = computed(() => inRoomsHint(buddy.mine))

  /** Reads her list (for the hint, and so that `canTurnOff` is true to the server). */
  async function refresh(): Promise<BuddyErrorCode | null> {
    if (!switchStore.available) return null
    const failed = await buddy.loadMine()
    if (!failed && buddy.mine) switchStore.noteRooms(buddy.mine.reads.length + buddy.mine.invitations.length)
    return failed
  }

  /** Her flip to off: `off` (nothing to leave: done), `asking` (the confirm is open) or `failed` (it could not be told: still on). */
  async function request(): Promise<'off' | 'asking' | 'failed'> {
    if (!switchStore.available || checking.value || busy.value) return 'failed'
    checkError.value = null
    checking.value = true
    const failed = await refresh()
    checking.value = false
    if (failed || !buddy.mine) {
      checkError.value = failed ?? 'offline'
      return 'failed'
    }
    if (!needsLeaving(plan.value)) return switchStore.set(false) ? 'off' : 'failed'
    deleteMessages.value = false
    error.value = null
    asking.value = true
    return 'asking'
  }

  /** "Leave and turn off": answers whether the switch is off now. */
  async function confirm(): Promise<boolean> {
    if (busy.value || !asking.value) return false
    busy.value = true
    error.value = null
    const refused = await leaveAndDecline(
      plan.value,
      { leave: (id, withMessages) => buddy.leave(id, withMessages), decline: (id) => buddy.answerInvite(id, false) },
      deleteMessages.value,
    )
    busy.value = false
    if (refused) {
      error.value = refused
      return false
    }
    // Everything is left: this is the one place the switch is let off.
    switchStore.noteRooms(0)
    // The invitations were declined: the lamp's list forgets them, so turning it on again does not show them.
    invites.reset()
    const off = switchStore.set(false)
    asking.value = false
    return off
  }

  function cancel() {
    if (busy.value) return
    asking.value = false
    error.value = null
  }

  return { asking, checking, busy, deleteMessages, error, checkError, plan, view, hint, refresh, request, confirm, cancel }
})
