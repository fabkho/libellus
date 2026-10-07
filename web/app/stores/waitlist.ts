import { defineStore } from 'pinia'
import { createWaitlist, waiting, type JoinErrorCode, type Waitlist, type WaitlistEntry, type WaitlistErrorCode } from '~/data/waitlist'
import { isShelfOwner } from '~/utils/shelfOwner'
import { useSessionStore } from '~/stores/session'

/**
 * The waitlist (data/waitlist.ts, issue #171), both sides.
 *
 * A visitor of a reading page, signed in or not, leaves her address with `join`; nothing of her is
 * kept here. The instance's owner reads the list in Profile → Account → Waitlist: the owner is
 * the member the build names (`NUXT_PUBLIC_SHELF_OWNER_ID`, as for Errors), the database checks
 * again and refuses anyone else, so for a member who is not the owner `isOwner` is false, nothing is
 * asked of the server and nothing is shown. A load that fails keeps the entries already on screen;
 * signing out (or another member signing in) forgets them all.
 */
export const useWaitlistStore = defineStore('waitlist', () => {
  const session = useSessionStore()
  const backend = useBackend()
  const config = useRuntimeConfig().public

  const isOwner = computed(() => isShelfOwner(session.member?.id, config.shelfOwnerId))

  let repository: Waitlist | null = null
  function repo(): Waitlist | null {
    if (!backend) return null
    repository ??= createWaitlist(backend, { online: isOnline })
    return repository
  }

  // ------------------------------------------------------------- the visitor

  /** Leaves an address from the reading page `token` belongs to; null when it went through. */
  async function join(email: string, token: string | null, website = ''): Promise<JoinErrorCode | null> {
    const r = repo()
    if (!r) return 'unknown'
    return (await r.join(email, token, website)).error
  }

  // --------------------------------------------------------------- the owner

  /** Newest first; null until the first load has answered. */
  const entries = ref<WaitlistEntry[] | null>(null)
  const loadError = ref<WaitlistErrorCode | null>(null)
  const loading = ref(false)
  /** What the last write (invited, delete) was refused with. */
  const writeError = ref<WaitlistErrorCode | null>(null)
  /** How many still wait for an invite: the Profile row's value. */
  const waitingCount = computed(() => (entries.value ? waiting(entries.value).length : null))

  let pending: Promise<void> | null = null

  function load(): Promise<void> {
    if (!isOwner.value) return Promise.resolve()
    pending ??= (async () => {
      const r = repo()
      if (!r) return
      const member = session.member?.id
      loading.value = true
      const result = await r.list()
      loading.value = false
      if (member !== session.member?.id) return
      if (result.error) {
        loadError.value = result.error
        return
      }
      loadError.value = null
      entries.value = result.data
    })().finally(() => (pending = null))
    return pending
  }

  /** Marks entries invited (or waiting again); shown on the list once the database says so. */
  async function setInvited(ids: readonly string[], invited: boolean): Promise<boolean> {
    const r = repo()
    if (!isOwner.value || !r || !entries.value) return false
    const member = session.member?.id
    writeError.value = null
    const result = await r.setInvited(ids, invited)
    if (member !== session.member?.id) return false
    if (result.error) {
      writeError.value = result.error
      return false
    }
    const now = new Date()
    entries.value = entries.value.map((entry) => (ids.includes(entry.id) ? { ...entry, invitedAt: invited ? (entry.invitedAt ?? now) : null } : entry))
    return true
  }

  /** Deletes one entry; gone from the list once the database says so. */
  async function remove(id: string): Promise<boolean> {
    const r = repo()
    if (!isOwner.value || !r || !entries.value) return false
    const member = session.member?.id
    writeError.value = null
    const result = await r.remove(id)
    if (member !== session.member?.id) return false
    if (result.error) {
      writeError.value = result.error
      return false
    }
    entries.value = (entries.value ?? []).filter((entry) => entry.id !== id)
    return true
  }

  function reset() {
    entries.value = null
    loadError.value = null
    writeError.value = null
  }

  watch(
    () => session.member?.id,
    (next, before) => next !== before && reset(),
  )

  return { isOwner, join, entries, loadError, loading, writeError, waitingCount, load, setInvited, remove, reset }
})
