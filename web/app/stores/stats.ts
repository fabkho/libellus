import { defineStore } from 'pinia'
import type { LibraryErrorCode } from '~/data/library'
import { createStats, type ReadingRecord, type Stats, type StatsYear } from '~/data/stats'
import { isoDay } from '~/utils/dates'
import { useSessionStore } from '~/stores/session'

/**
 * The Profile's reading record (issue #78, data/stats.ts) and what the Profile
 * shows of it: the year picked in the year pills (All first), kept while the
 * member opens a year in review or a book and comes back. Loaded when the
 * Profile or a year in review opens, and again each time; a load that fails
 * keeps the last record on screen (offline it is not asked for). Signing out
 * (or another member signing in) forgets all of it. Read only: nothing here
 * writes, so nothing is kept on the device.
 */
export const useStatsStore = defineStore('stats', () => {
  const backend = useBackend()
  const session = useSessionStore()

  let repository: Stats | null = null
  function stats(): Stats | null {
    if (!backend) return null
    repository ??= createStats(backend)
    return repository
  }

  const record = ref<ReadingRecord | null>(null)
  const loadError = ref<LibraryErrorCode | null>(null)
  /** The year in the pills: All, or a year with a finished read. */
  const year = ref<StatsYear>('all')

  async function load() {
    const repo = stats()
    if (!repo) return
    if (!isOnline()) {
      if (!record.value) loadError.value = 'offline'
      return
    }
    const member = session.member?.id
    const result = await repo.record(isoDay())
    if (member !== session.member?.id) return
    if (result.error) {
      loadError.value = result.error
      return
    }
    loadError.value = null
    record.value = result.data
    // A year that has no finished read any more (a read deleted) goes back to All.
    if (year.value !== 'all' && !result.data.reads.some((r) => r.outcome === 'finished' && r.endedOn?.startsWith(String(year.value)))) {
      year.value = 'all'
    }
  }

  function reset() {
    record.value = null
    loadError.value = null
    year.value = 'all'
  }

  watch(
    () => session.member?.id,
    (now, before) => now !== before && reset(),
  )

  // Back online with the Profile waiting on it: load without a tap.
  const online = useOnline()
  watch(online, (now) => {
    if (now && loadError.value === 'offline') void load()
  })

  return { record, loadError, year, load, reset }
})
