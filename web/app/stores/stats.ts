import { defineStore } from 'pinia'
import type { LibraryErrorCode } from '~/data/library'
import { readStats, saveStats } from '~/data/deviceLibrary'
import { createStats, type ReadingRecord, type Stats, type StatsYear } from '~/data/stats'

/** A sheet of the Profile or a year in review: a month's books, or a star row's. */
export type ProfileSheet = { kind: 'month'; year: number; month: number } | { kind: 'stars'; year: StatsYear; star: number }
import { isoDay } from '~/utils/dates'
import { afterTransition } from '~/utils/viewTransition'
import { useSessionStore } from '~/stores/session'

/**
 * The Profile's reading record (issue #78, data/stats.ts) and what the Profile
 * shows of it: the year picked in the year pills (All first), kept while the
 * member opens a year in review or a book and comes back. Loaded when the
 * Profile or a year in review opens, and again each time; a load that fails
 * keeps the last record on screen (offline it is not asked for). Signing out
 * (or another member signing in) forgets all of it. Read only: nothing here
 * writes.
 *
 * The device keeps the last record (data/deviceLibrary.ts, `saveStats`),
 * written after every load and read back when the store is set up, so the
 * Profile opens with its figures at once and the load that follows only
 * refreshes them; only the very first visit on a device shows the loading
 * placeholders (docs/MOTION.md, Loading). Signing out removes it with the rest
 * of `libellus.`.
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
  /**
   * The sheet that was open when the member opened a book from it (what it showed, and how
   * far its list was scrolled), with the page it was on: Back from the book opens it again
   * (composables/useSheetRestore.ts).
   */
  const keptSheet = ref<{ page: string; sheet: unknown; scroll: number } | null>(null)

  async function load() {
    const repo = stats()
    if (!repo) return
    if (!isOnline()) {
      if (!record.value) loadError.value = 'offline'
      return
    }
    const member = session.member?.id
    const result = await repo.record(isoDay())
    // The push to the Profile may still be playing: the answer lands once it has (utils/viewTransition.ts).
    await afterTransition()
    if (member !== session.member?.id) return
    if (result.error) {
      loadError.value = result.error
      return
    }
    loadError.value = null
    // The same record as the one showing (the device's copy, or the last load) changes nothing on the page.
    if (!record.value || JSON.stringify(toRaw(record.value)) !== JSON.stringify(result.data)) record.value = result.data
    if (import.meta.client && member) saveStats(window.localStorage, member, result.data)
    // A year that has no finished read any more (a read deleted) goes back to All.
    if (year.value !== 'all' && !result.data.reads.some((r) => r.outcome === 'finished' && r.endedOn?.startsWith(String(year.value)))) {
      year.value = 'all'
    }
  }

  function reset() {
    record.value = null
    loadError.value = null
    year.value = 'all'
    keptSheet.value = null
  }

  /** Puts back the record this device saw last, if it is this member's. */
  function restore() {
    const member = session.member?.id
    if (!import.meta.client || !member || record.value) return
    record.value = readStats(window.localStorage, member)
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

  // Back online with the Profile waiting on it: load without a tap.
  const online = useOnline()
  watch(online, (now) => {
    if (now && loadError.value === 'offline') void load()
  })

  return { record, loadError, year, keptSheet, load, reset }
})
