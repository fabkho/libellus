import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { BuddyCard, BuddyInvitation, MyBuddyReads } from '~/data/buddyReads'
import { useSessionStore } from '~/stores/session'

/**
 * Her buddy read list, `my_buddy_reads()`: the invitations waiting for her and the reads she is in, and nothing else of buddy reads. It is what the lamp dot
 * on the header's avatar (components/shell/Header.vue, part of the entry), the invitation row on Friends, Home's *Reading together* card and the Book
 * page's action ask. It is the small door: the big store (stores/buddyRead.ts, with the send queue, the chat layer and the live channel) stays out of it
 * and out of the entry (tests/buddy-read-entry.test.ts), so Home and a Book page load no chat layer and no Realtime client; this store holds only the list,
 * and the repository (`data/buddyReads.ts`, framework-free, the chat layer's types only) is loaded by a dynamic `import()` the first time she is asked about.
 *
 * Nothing is asked, and nothing shown, while nobody is signed in (`active`). It reads her list on its own (`load`: the shell when it starts and when the app comes back to the foreground,
 * Friends when it opens); a screen that answers an invitation tells it (`drop`), and one that read `my_buddy_reads` itself may hand the
 * invitations over (`take`, Home's card).
 */
export const useBuddyInvitesStore = defineStore('buddyInvites', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const online = useOnline()

  const invitations = ref<BuddyInvitation[]>([])
  /** The reads she is in (`my_buddy_reads().reads`: active first, then the last few that ended); empty until the list was read. */
  const reads = ref<BuddyCard[]>([])
  /** Whether the list was read at least once for this member. */
  const loaded = ref(false)

  const me = computed(() => session.member?.id ?? null)
  /** A member is signed in: buddy reads are for everyone. */
  const active = computed(() => !!me.value)
  /** What the lamp dot and the row show; none while signed out. */
  const waiting = computed(() => (active.value ? invitations.value : []))
  const count = computed(() => waiting.value.length)

  let reading: Promise<void> | null = null
  /** When the list was last read or handed over (ms): a reading inside `FRESH_MS` is not asked again (the shell asks on every start and every return to the foreground). */
  let loadedAt = 0

  /** How long a list is fresh: the header asks on every mount and every return to the foreground, the server need not hear it each time. */
  const FRESH_MS = 45_000

  /** Reads her invitations (one query); keeps what it had when it cannot. `force`: not even a fresh list will do. */
  function load({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (!active.value || !backend || !online.value) return Promise.resolve()
    if (!force && loadedAt && Date.now() - loadedAt < FRESH_MS) return Promise.resolve()
    const member = me.value
    reading ??= (async () => {
      const { createBuddyReads } = await import('~/data/buddyReads')
      const answer = await createBuddyReads(backend, { online: isOnline, self: () => member }).mine()
      // She signed out or another member came in while it was asked.
      if (answer.error || me.value !== member) return
      invitations.value = answer.data.invitations
      reads.value = answer.data.reads
      loaded.value = true
      loadedAt = Date.now()
    })().finally(() => {
      reading = null
    })
    return reading
  }

  /** The big store read her list (a room's screen, an answered invitation): its answer is the list. */
  function take(list: MyBuddyReads) {
    invitations.value = list.invitations
    reads.value = list.reads
    loaded.value = true
    loadedAt = Date.now()
  }

  /** An invitation was answered: it leaves the list at once, before the next reading. */
  function drop(id: string) {
    invitations.value = invitations.value.filter((i) => i.id !== id)
  }

  function reset() {
    invitations.value = []
    reads.value = []
    loaded.value = false
    loadedAt = 0
  }
  watch(me, (now, before) => {
    if (now !== before) reset()
  })

  return { invitations, reads, loaded, active, waiting, count, load, take, drop, reset }
})
