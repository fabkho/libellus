import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'
import { hasImportedBooks } from '~/data/importedBooks'
import { importOffer, readImportHint, writeImportHint, type ImportHintMemory } from '~/utils/importHint'

/**
 * Home's offer of the import (utils/importHint.ts has the rules). `offer` is decided from
 * the Library as this device holds it and the device's memory of the member, both read
 * synchronously, so the card is in the first frame or not at all and nothing moves when
 * the lists load.
 *
 * A member with a few entries and no memory yet is asked once whether she imported
 * elsewhere (`hasImportedBooks`); a yes is remembered and the small card goes. Offline or
 * failing, the question is dropped and asked again next time.
 */
const memory = ref<ImportHintMemory | null>(null)
let checked: string | null = null

export function useImportOffer() {
  const library = useLibraryStore()
  const session = useSessionStore()
  const backend = useBackend()

  /** The member's memory, read from the device (on mount, and when a kept-alive Home comes back). */
  function refresh() {
    const member = session.member?.id
    memory.value = import.meta.client && member ? readImportHint(window.localStorage, member) : null
  }
  refresh()
  watch(() => session.member?.id, refresh)

  const entryCount = computed(() => library.wantToRead.length + library.reading.length + library.finished.length)
  const offer = computed(() => (library.loaded ? importOffer(entryCount.value, memory.value) : 'none'))

  function remember(value: ImportHintMemory) {
    const member = session.member?.id
    if (!member) return
    writeImportHint(window.localStorage, member, value)
    memory.value = readImportHint(window.localStorage, member) ?? value
  }

  function dismiss() {
    remember('dismissed')
  }

  /** Asks the database once per member and visit whether she imported before, for the small offer. */
  async function verify() {
    const member = session.member?.id
    if (!member || !backend || offer.value !== 'small' || checked === member) return
    checked = member
    const answer = await hasImportedBooks(backend)
    if (answer.data && member === session.member?.id) remember('imported')
    else if (answer.error) checked = null
  }
  watch(offer, () => void verify(), { immediate: true })

  return { offer, refresh, dismiss }
}
