import { defineStore } from 'pinia'
import type { LibraryErrorCode } from '~/data/library'
import { readStats, saveStats } from '~/data/deviceLibrary'
import { createStats, type ReadingRecord, type Stats, type StatsYear } from '~/data/stats'

/** A sheet of the Profile or a year in review: a month's books, a star row's, the reads without a page count, or a day's. */
export type ProfileSheet =
  | { kind: 'month'; year: number; month: number }
  | { kind: 'stars'; year: StatsYear; star: number }
  | { kind: 'pagesMissing'; year: StatsYear }
  | { kind: 'day'; day: string }
import { isoDay } from '~/utils/dates'
import { createFreshness } from '~/utils/fresh'
import { afterTransition } from '~/utils/viewTransition'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

/**
 * The Profile's reading record (issue #78, data/stats.ts) and what the Profile
 * shows of it: the year picked in the year pills (All first), kept while the
 * member opens a year in review or a book and comes back. Loaded when the
 * Profile or a year in review opens, but not again within `FRESH_MS` of the last
 * answer (`load({ ifStale })`, utils/fresh.ts): a run of visits is one read of the
 * member's sessions. A change of hers (the Library store's `changes`: a finish, an
 * edit of a read, a removal, the outbox drained) forgets that at once, so the next
 * visit shows it; Retry and a member change always ask. A load that fails
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
  const library = useLibraryStore()

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

  const freshness = createFreshness()
  /** The read on its way: a visit asked while it is gets that one. */
  let loading: Promise<void> | null = null

  /** `ifStale`: a visit (Profile, a year in review), which a record this fresh stands for. Anything else asks. */
  function load({ ifStale = false }: { ifStale?: boolean } = {}): Promise<void> {
    if (ifStale) {
      if (loading) return loading
      if (record.value && !loadError.value && freshness.isFresh()) return Promise.resolve()
    }
    const run = read().finally(() => {
      if (loading === run) loading = null
    })
    loading = run
    return run
  }

  async function read() {
    const repo = stats()
    if (!repo) return
    if (!isOnline()) {
      if (!record.value) loadError.value = 'offline'
      return
    }
    const ticket = freshness.ask()
    const member = session.member?.id
    const result = await repo.record(isoDay())
    // The push to the Profile may still be playing: the answer lands once it has (utils/viewTransition.ts).
    await afterTransition()
    if (member !== session.member?.id) return
    // A change of hers was made meanwhile (a finish while the Profile was opening): this answer may not have it.
    if (freshness.outdated(ticket)) return read()
    if (result.error) {
      loadError.value = result.error
      return
    }
    loadError.value = null
    freshness.landed(ticket)
    // The same record as the one showing (the device's copy, or the last load) changes nothing on the page.
    if (!record.value || JSON.stringify(toRaw(record.value)) !== JSON.stringify(result.data)) record.value = result.data
    if (import.meta.client && member) saveStats(window.localStorage, member, result.data)
    // A year that has no finished read any more (a read deleted) goes back to All.
    if (year.value !== 'all' && !result.data.reads.some((r) => r.outcome === 'finished' && r.endedOn?.startsWith(String(year.value)))) {
      year.value = 'all'
    }
  }

  function reset() {
    freshness.invalidate()
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

  // A change of hers that the record does not show yet: the next visit asks.
  watch(() => library.changes, freshness.invalidate, { flush: 'sync' })

  // Back online with the Profile waiting on it: load without a tap.
  const online = useOnline()
  watch(online, (now) => {
    if (now && loadError.value === 'offline') void load()
  })

  return { record, loadError, year, keptSheet, load, reset }
})
