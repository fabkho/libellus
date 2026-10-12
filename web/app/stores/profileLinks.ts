import { defineStore } from 'pinia'
import {
  createProfileLinks,
  type MyProfileLinks,
  type ProfileLink,
  type ProfileLinkDrafts,
  type ProfileLinks,
  type ProfileLinksErrorCode,
} from '~/data/profileLinks'
import type { LinkVisibility, SocialPlatform } from '~/utils/socialLinks'
import { useSessionStore } from '~/stores/session'

/**
 * Profile links (WP-22, data/profileLinks.ts): her own links and who sees them, which the Profile's hero shows
 * and the Links sheet edits, and the links of the members she opens (`forMember`, an empty list when that
 * member does not show them to her). Online only: nothing is kept on the device, and signing out (or another
 * member signing in) forgets all of it.
 */
export const useProfileLinksStore = defineStore('profileLinks', () => {
  const backend = useBackend()
  const session = useSessionStore()

  let repository: ProfileLinks | null = null
  function repo(): ProfileLinks | null {
    if (!backend) return null
    repository ??= createProfileLinks(backend, { online: isOnline })
    return repository
  }

  /** Hers; null until known. */
  const own = ref<MyProfileLinks | null>(null)
  const saving = ref(false)
  const saveError = ref<{ code: ProfileLinksErrorCode; platform: SocialPlatform | null } | null>(null)
  /** Other members' links by member id, as last read. */
  const others = ref<Record<string, ProfileLink[]>>({})

  let loading: Promise<void> | null = null
  let loadedFor: string | null = null

  /** Reads her links, once per member unless `force`. A failure leaves what was there. */
  function load(force = false): Promise<void> {
    const member = session.member?.id
    if (!member || (!force && loadedFor === member)) return Promise.resolve()
    loading ??= (async () => {
      const r = repo()
      if (!r || !isOnline()) return
      const result = await r.mine()
      if (member !== session.member?.id || result.error) return
      loadedFor = member
      own.value = result.data
    })().finally(() => (loading = null))
    return loading
  }

  /** Replaces her links and her setting; true when saved. */
  async function save(drafts: ProfileLinkDrafts, visibility: LinkVisibility): Promise<boolean> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || saving.value) return false
    saving.value = true
    saveError.value = null
    const result = await r.save(drafts, visibility)
    saving.value = false
    if (member !== session.member?.id) return false
    if (result.error) {
      saveError.value = { code: result.error, platform: result.platform ?? null }
      return false
    }
    own.value = result.data
    loadedFor = member
    return true
  }

  /** Reads another member's links (what she shows the signed-in member); the last answer stays on a failure. */
  async function loadFor(member: string): Promise<void> {
    const r = repo()
    const me = session.member?.id
    if (!r || !me || !isOnline()) return
    const result = await r.of(member)
    if (me !== session.member?.id || result.error) return
    others.value = { ...others.value, [member]: result.data }
  }

  const forMember = (member: string): ProfileLink[] => others.value[member] ?? []

  function clearSaveError() {
    saveError.value = null
  }

  function reset() {
    own.value = null
    others.value = {}
    saveError.value = null
    loadedFor = null
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) reset()
    },
  )

  return { own, saving, saveError, load, save, loadFor, forMember, clearSaveError, reset }
})
