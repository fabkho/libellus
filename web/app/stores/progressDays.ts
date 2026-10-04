import { defineStore } from 'pinia'
import type { ProgressDay } from '~/data/progressDays'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

/**
 * Progress by day of the reads on screen (issue #68): Home's cards and the book
 * page ask for their read's days (`want`), and the asks of one moment go out as
 * one call (`progressDays`). A progress save or Undo asks for its read again
 * (`refresh`). Kept in memory only: offline, a read whose days were never loaded
 * has none to show, and the screens fall back to what they showed before #68.
 * Signing out (or another member signing in) forgets them.
 */
export const useProgressDaysStore = defineStore('progressDays', () => {
  const library = useLibraryStore()
  const session = useSessionStore()

  /** Each read's days, oldest first, by session id; absent until they have been loaded. */
  const bySession = ref<Record<string, ProgressDay[]>>({})
  const asked = new Set<string>()
  /** How often each read was asked for: only the answer to the latest ask is kept. */
  const asks = new Map<string, number>()
  let queued: Set<string> | null = null

  async function flush(ids: string[]) {
    const repo = library.library()
    const member = session.member?.id
    if (!repo) return
    const sent = new Map(ids.map((id) => [id, asks.get(id)]))
    const result = await repo.progressDays(ids)
    if (member !== session.member?.id) return
    const current = ids.filter((id) => asks.get(id) === sent.get(id))
    if (result.error) {
      // Asked again the next time a screen wants them.
      for (const id of current) asked.delete(id)
      return
    }
    bySession.value = { ...bySession.value, ...Object.fromEntries(current.map((id) => [id, result.data[id] ?? []])) }
  }

  /** A screen shows this read: its days, unless they are loaded or on the way. */
  function want(sessionId: string | null | undefined) {
    if (!sessionId || asked.has(sessionId)) return
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
    want(sessionId)
  }

  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      bySession.value = {}
      asked.clear()
      asks.clear()
    },
  )

  return { bySession, want, refresh }
})
