import { defineStore } from 'pinia'
import {
  createOwnerErrors,
  newGroups,
  type OwnerErrorDetail,
  type OwnerErrorGroup,
  type OwnerErrors,
  type OwnerErrorsErrorCode,
} from '~/data/ownerErrors'
import { isShelfOwner } from '~/utils/shelfOwner'
import { useSessionStore } from '~/stores/session'

/**
 * The client error log in the app (data/ownerErrors.ts), for the instance's
 * owner only: the Profile's Errors row and its page. The owner is the member
 * the build names (`NUXT_PUBLIC_SHELF_OWNER_ID`, the same one that has Your
 * shelf, with or without Regal); the database checks again and refuses anyone
 * else, so for a member who is not the owner `isOwner` is false, nothing is
 * asked of the server and nothing is shown. Loaded when the Profile or the
 * page opens (and again on Refresh); a load that fails keeps the groups
 * already on screen. Signing out (or another member signing in) forgets it all.
 */
export const useOwnerErrorsStore = defineStore('ownerErrors', () => {
  const session = useSessionStore()
  const backend = useBackend()
  const config = useRuntimeConfig().public

  const isOwner = computed(() => isShelfOwner(session.member?.id, config.shelfOwnerId))

  let repository: OwnerErrors | null = null
  function repo(): OwnerErrors | null {
    if (!backend) return null
    repository ??= createOwnerErrors(backend, { online: isOnline })
    return repository
  }

  /** The last 7 days' groups; null until the first load has answered. */
  const groups = ref<OwnerErrorGroup[] | null>(null)
  const loadError = ref<OwnerErrorsErrorCode | null>(null)
  const loading = ref(false)
  /** The clock the badge counts against, moved on by every load. */
  const now = ref(Date.now())
  /** Groups first seen in the last 24 hours: the Profile row's badge. */
  const fresh = computed(() => newGroups(groups.value ?? [], now.value).length)

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
      now.value = Date.now()
      groups.value = result.data
    })().finally(() => (pending = null))
    return pending
  }

  /** One group's newest report, kept for the session: a stack does not change. */
  const details = ref<Record<string, OwnerErrorDetail | null>>({})
  const detailError = ref<OwnerErrorsErrorCode | null>(null)
  const detailLoading = ref(false)

  async function loadDetail(hash: string, last: Date): Promise<void> {
    if (!isOwner.value) return
    const known = details.value[hash]
    // What was fetched after the group's last report is still the newest.
    if (known && known.lastSeen.getTime() >= last.getTime()) return
    const r = repo()
    if (!r) return
    const member = session.member?.id
    detailLoading.value = true
    detailError.value = null
    const result = await r.detail(hash)
    detailLoading.value = false
    if (member !== session.member?.id) return
    if (result.error) {
      detailError.value = result.error
      return
    }
    details.value = { ...details.value, [hash]: result.data }
  }

  function reset() {
    groups.value = null
    loadError.value = null
    details.value = {}
    detailError.value = null
  }

  watch(
    () => session.member?.id,
    (next, before) => next !== before && reset(),
  )

  return { isOwner, groups, loadError, loading, now, fresh, load, details, detailError, detailLoading, loadDetail, reset }
})
