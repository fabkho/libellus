import { defineStore } from 'pinia'
import { resolveShare, type ShareOutcome } from '~/data/shareResolve'
import { useSearchStore } from '~/stores/search'
import { parseShared, type SharedPayload } from '~/utils/shared'

/**
 * Where a share leads (issue #91): reads what the share sheet handed over and
 * asks the search sources for the Book it names. The page decides where to
 * go from the outcome.
 */
export const useShareStore = defineStore('share', () => {
  const backend = useBackend()
  const search = useSearchStore()

  async function resolve(payload: SharedPayload): Promise<ShareOutcome> {
    return resolveShare(parseShared(payload), { search: search.repository(), client: backend })
  }

  return { resolve }
})
