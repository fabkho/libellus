import { defineStore } from 'pinia'
import { emptyCopy, readEnrichCopy, saveEnrichCopy, type EnrichCopy } from '~/data/enrich/device'
import { useSessionStore } from '~/stores/session'

/**
 * The device's copy of what the author pages and the series showed last
 * (data/enrich/device.ts, issue #167): read when the store is set up and for
 * each member who signs in, written (once a task at most) after the authors
 * and series stores change it. Another member's copy is never read.
 */
export const useEnrichCopyStore = defineStore('enrichCopy', () => {
  const session = useSessionStore()
  const data = shallowRef<EnrichCopy>(emptyCopy(''))

  function restore() {
    const member = session.member?.id ?? ''
    data.value = import.meta.client && member ? readEnrichCopy(window.localStorage, member) : emptyCopy(member)
  }

  let queued = false
  /** Puts `change` into the copy and writes it soon (several changes in one task are one write). */
  function update(change: (copy: EnrichCopy) => Partial<EnrichCopy>) {
    const member = session.member?.id
    if (!member) return
    const base = data.value.memberId === member ? data.value : emptyCopy(member)
    data.value = { ...base, ...change(base) }
    if (!import.meta.client || queued) return
    queued = true
    setTimeout(() => {
      queued = false
      if (data.value.memberId === session.member?.id) saveEnrichCopy(window.localStorage, data.value)
    }, 0)
  }

  watch(
    () => session.member?.id,
    (now, before) => now !== before && restore(),
  )
  restore()

  return { data, update }
})
