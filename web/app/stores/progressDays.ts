import { defineStore } from 'pinia'
import type { LibraryEntry } from '~/data/library'
import { pageCountOf, progressOf, type ProgressValue } from '~/data/progress'
import { dayEdit, type ProgressDay } from '~/data/progressDays'
import { isLocalId, type QueuedAction } from '~/data/queuedWrites'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'
import { useSyncStore } from '~/stores/sync'

/** One earlier-day write that waits in the outbox: the day and where it ended (null: the day is removed). */
export type DayOp = { day: string; value: ProgressValue | null }

/** What waits for one read: its writes in order, and the read as they were made on (`dayEdit`'s context). */
type PendingDays = { entryId: string; ops: DayOp[]; current: ProgressValue | null; pageCount: number | null; startedOn: string | null }

const DAY_ACTIONS: ReadonlySet<QueuedAction> = new Set(['set_progress_day', 'delete_progress_day'])

/**
 * Progress by day of the reads on screen (issue #68): Home's cards and the book
 * page ask for their read's days (`want`), and the asks of one moment go out as
 * one call (`progressDays`). A progress save or Undo asks for its read again
 * (`refresh`; `refreshing` says until the answer is in, so the book page can
 * show what a save changed in one go, #79). Kept in memory only: offline, a read whose days were never loaded
 * has none to show, and the screens fall back to what they showed before #68.
 * Signing out (or another member signing in) forgets them.
 */
export const useProgressDaysStore = defineStore('progressDays', () => {
  const library = useLibraryStore()
  const session = useSessionStore()
  const sync = useSyncStore()

  /** Each read's days, oldest first, by session id; absent until they have been loaded. */
  const bySession = ref<Record<string, ProgressDay[]>>({})
  /**
   * Earlier-day writes that wait in the outbox (offline, or behind another write), by session id: laid over the
   * days with the database's own rules (`dayEdit`) so the log, chart and sheet show a day at once. Dropped when the
   * days come back from the database and none of the read's writes waits any more (plan, risk 5); the database
   * clamps against the neighbours it finds, so what it answers wins.
   */
  const pending = ref<Record<string, PendingDays>>({})
  const asked = new Set<string>()
  /** How often each read was asked for: only the answer to the latest ask is kept. */
  const asks = new Map<string, number>()
  /** Reads whose days were asked for again after a save or Undo and have not come back yet (issue #79). */
  const refreshing = ref<Record<string, true>>({})
  let queued: Set<string> | null = null

  function settle(ids: string[]) {
    if (!ids.some((id) => refreshing.value[id])) return
    const rest = { ...refreshing.value }
    for (const id of ids) delete rest[id]
    refreshing.value = rest
  }

  /** Whether a day write of this entry still waits in the outbox. */
  const waiting = (entryId: string) => sync.items.some((item) => item.entryId === entryId && DAY_ACTIONS.has(item.action))

  /** The days of these reads came back from the database: what no longer waits is in them. */
  function dropSynced(ids: string[]) {
    const synced = ids.filter((id) => pending.value[id] && !waiting(pending.value[id]!.entryId))
    if (!synced.length) return
    const rest = { ...pending.value }
    for (const id of synced) delete rest[id]
    pending.value = rest
  }

  async function flush(ids: string[]) {
    const repo = library.library()
    const member = session.member?.id
    if (!repo) return settle(ids)
    const sent = new Map(ids.map((id) => [id, asks.get(id)]))
    const result = await repo.progressDays(ids)
    if (member !== session.member?.id) return
    const current = ids.filter((id) => asks.get(id) === sent.get(id))
    if (result.error) {
      // Asked again the next time a screen wants them.
      for (const id of current) asked.delete(id)
      return settle(current)
    }
    bySession.value = { ...bySession.value, ...Object.fromEntries(current.map((id) => [id, result.data[id] ?? []])) }
    dropSynced(current)
    settle(current)
  }

  /**
   * A day write of `entry` (the entry as it was before the write) went to the outbox rather than to the database:
   * its day is laid over the read's days until they come back with it. Nothing waits, nothing is held.
   */
  function hold(entry: LibraryEntry, op: DayOp) {
    const sessionId = entry.latestSession?.id
    if (!sessionId || !waiting(entry.id)) return
    const before = pending.value[sessionId]
    pending.value = {
      ...pending.value,
      [sessionId]: {
        entryId: entry.id,
        ops: [...(before?.ops ?? []), op],
        current: before?.current ?? progressOf(entry.latestSession),
        pageCount: before?.pageCount ?? pageCountOf(entry),
        startedOn: before?.startedOn ?? entry.latestSession?.startedOn ?? null,
      },
    }
  }

  /**
   * Each read's days as the screens show them: the database's (`bySession`) with the writes that wait laid over
   * them. A read whose days were never loaded has none, whatever waits.
   */
  const shown = computed<Record<string, ProgressDay[]>>(() => {
    const out = { ...bySession.value }
    for (const [id, wait] of Object.entries(pending.value)) {
      let days = out[id]
      if (!days) continue
      let current = wait.current
      for (const op of wait.ops) {
        const edit = dayEdit(days, op.day, op.value, { current, pageCount: wait.pageCount, startedOn: wait.startedOn })
        days = edit.days
        current = edit.current
      }
      out[id] = days
    }
    return out
  })

  /** A screen shows this read: its days, unless they are loaded or on the way. */
  function want(sessionId: string | null | undefined) {
    // A read started offline (issue #93) has no days in the database until it syncs.
    if (!sessionId || isLocalId(sessionId) || asked.has(sessionId)) return
    asked.add(sessionId)
    asks.set(sessionId, (asks.get(sessionId) ?? 0) + 1)
    if (queued) return void queued.add(sessionId)
    queued = new Set([sessionId])
    queueMicrotask(() => {
      const ids = [...queued!]
      queued = null
      void flush(ids)
    })
  }

  /** The read's days changed (a save, an Undo): asked for again. */
  function refresh(sessionId: string | null | undefined) {
    if (!sessionId) return
    asked.delete(sessionId)
    refreshing.value = { ...refreshing.value, [sessionId]: true }
    want(sessionId)
  }

  /** Every read on screen, asked for again (writes that waited have synced, issue #93). */
  function refreshAll() {
    for (const sessionId of Object.keys(bySession.value)) {
      asked.delete(sessionId)
      want(sessionId)
    }
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      bySession.value = {}
      pending.value = {}
      refreshing.value = {}
      asked.clear()
      asks.clear()
    },
  )

  return { bySession, shown, pending, refreshing, want, hold, refresh, refreshAll }
})
