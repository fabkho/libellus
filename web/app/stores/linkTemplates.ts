import { defineStore } from 'pinia'
import {
  bookLinks,
  createLinkTemplates,
  parseLinkTemplates,
  readDeviceLinkTemplates,
  saveDeviceLinkTemplates,
  type BookLink,
  type LinkBook,
  type LinkTemplate,
  type LinkTemplates,
  type LinkTemplatesErrorCode,
} from '~/data/linkTemplates'
import { useSessionStore } from '~/stores/session'

/**
 * Book links (issue #116, data/linkTemplates.ts): the instance's defaults (the
 * build's NUXT_PUBLIC_LINK_TEMPLATES) and the member's own list, which the Book
 * page fills for its Book and the Profile's Book links sheet edits. Her list is
 * loaded when either opens, once per sign-in and again after every save; the
 * device keeps the last one (`libellus.linkTemplates`), so a Book's page has her
 * links offline too. Signing out (or another member signing in) forgets it.
 */
export const useLinkTemplatesStore = defineStore('linkTemplates', () => {
  const backend = useBackend()
  const session = useSessionStore()

  let repository: LinkTemplates | null = null
  function repo(): LinkTemplates | null {
    if (!backend) return null
    repository ??= createLinkTemplates(backend, { online: isOnline })
    return repository
  }

  /** The instance's, from the build: the same for every member. */
  const instance = parseLinkTemplates(useRuntimeConfig().public.linkTemplates)
  /** Hers; null until known. */
  const own = ref<LinkTemplate[] | null>(null)
  const loadError = ref<LinkTemplatesErrorCode | null>(null)
  const saving = ref(false)
  const saveError = ref<LinkTemplatesErrorCode | null>(null)

  let loading: Promise<void> | null = null
  let loadedFor: string | null = null

  /** Reads her list, once per member unless `force`. */
  function load(force = false): Promise<void> {
    const member = session.member?.id
    if (!member || (!force && loadedFor === member)) return Promise.resolve()
    loading ??= (async () => {
      const r = repo()
      if (!r) return
      if (!isOnline()) {
        loadError.value = 'offline'
        return
      }
      const result = await r.load()
      if (member !== session.member?.id) return
      if (result.error) {
        loadError.value = result.error
        return
      }
      loadError.value = null
      loadedFor = member
      own.value = result.data
      if (import.meta.client) saveDeviceLinkTemplates(window.localStorage, member, result.data)
    })().finally(() => (loading = null))
    return loading
  }

  /** Replaces her list; true when it was saved. */
  async function save(templates: readonly LinkTemplate[]): Promise<boolean> {
    const r = repo()
    const member = session.member?.id
    if (!r || !member || saving.value) return false
    saving.value = true
    saveError.value = null
    const result = await r.save(templates)
    saving.value = false
    if (member !== session.member?.id) return false
    if (result.error) {
      saveError.value = result.error
      return false
    }
    own.value = result.data
    loadedFor = member
    if (import.meta.client) saveDeviceLinkTemplates(window.localStorage, member, result.data)
    return true
  }

  /** The Book's links: the instance's first, then hers, each list in its order. */
  function linksFor(book: LinkBook): BookLink[] {
    return bookLinks([...instance, ...(own.value ?? [])], book)
  }

  function clearSaveError() {
    saveError.value = null
  }

  function reset() {
    own.value = null
    loadError.value = null
    saveError.value = null
    loadedFor = null
  }

  /** Puts back the list this device saw last, if it is this member's. */
  function restore() {
    const member = session.member?.id
    if (!import.meta.client || !member) return
    own.value = readDeviceLinkTemplates(window.localStorage, member)
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      reset()
      restore()
    },
  )
  restore()

  // Back online with her list never read: read it now.
  const online = useOnline()
  watch(online, (now) => {
    if (now && loadError.value === 'offline') void load()
  })

  return { instance, own, loadError, saving, saveError, load, save, linksFor, clearSaveError, reset }
})
