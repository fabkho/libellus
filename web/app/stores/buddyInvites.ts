import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { BuddyInvitation } from '~/data/buddyReads'
import { useBuddyReadsSwitchStore } from '~/stores/buddyReadsSwitch'
import { useSessionStore } from '~/stores/session'

/**
 * The buddy read invitations waiting for her, and nothing else of buddy reads: what the lamp dot on the header's avatar (components/shell/Header.vue,
 * which is part of the entry) and the invitation row on Friends ask. It is the small door the entry may import: the big store (stores/buddyRead.ts, with
 * the send queue and the live channel) must stay out of it (tests/buddy-read-entry.test.ts), so this one holds only the list, and the repository
 * (`data/buddyReads.ts`) is loaded by a dynamic `import()` the first time she is asked about.
 *
 * Nothing is asked, and nothing shown, unless this build has buddy reads and she turned them on (`active`): a build without the feature
 * never calls `my_buddy_reads`. It reads her list on its own (`load`: the shell when it starts and when the app comes back to the foreground,
 * Friends when it opens); a screen that answers an invitation tells it (`drop`), and one that read `my_buddy_reads` itself may hand the
 * invitations over (`take`, W5's Home card).
 */
export const useBuddyInvitesStore = defineStore('buddyInvites', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const switchStore = useBuddyReadsSwitchStore()
  const online = useOnline()

  const invitations = ref<BuddyInvitation[]>([])
  /** Whether the list was read at least once for this member. */
  const loaded = ref(false)

  const me = computed(() => session.member?.id ?? null)
  /** This build has buddy reads and she turned them on. */
  const active = computed(() => switchStore.available && switchStore.enabled && !!me.value)
  /** What the lamp dot and the row show; none while it is off. */
  const waiting = computed(() => (active.value ? invitations.value : []))
  const count = computed(() => waiting.value.length)

  let reading: Promise<void> | null = null

  /** Reads her invitations (one query); keeps what it had when it cannot. */
  function load(): Promise<void> {
    if (!active.value || !backend || !online.value) return Promise.resolve()
    const member = me.value
    reading ??= (async () => {
      const { createBuddyReads } = await import('~/data/buddyReads')
      const answer = await createBuddyReads(backend, { online: isOnline, self: () => member }).mine()
      // She signed out or another member came in while it was asked.
      if (answer.error || me.value !== member) return
      invitations.value = answer.data.invitations
      loaded.value = true
      // The same reading tells the switch whether she may turn it off: a room she joined on another device counts.
      switchStore.noteRooms(answer.data.reads.length + answer.data.invitations.length)
    })().finally(() => (reading = null))
    return reading
  }

  /** The big store read her reads: the invitations in its answer are the list. */
  function take(list: BuddyInvitation[]) {
    invitations.value = list
    loaded.value = true
  }

  /** An invitation was answered: it leaves the list at once, before the next reading. */
  function drop(id: string) {
    invitations.value = invitations.value.filter((i) => i.id !== id)
  }

  function reset() {
    invitations.value = []
    loaded.value = false
  }
  watch(me, (now, before) => {
    if (now !== before) reset()
  })

  return { invitations, loaded, active, waiting, count, load, take, drop, reset }
})
