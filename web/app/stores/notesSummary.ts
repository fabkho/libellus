import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { NotesSummary } from '~/data/notes'
import { useSessionStore } from '~/stores/session'

/**
 * The Book page's Notes lines, `notes_summary(book)`: what her friends wrote on this Book and what members made public, by the numbers, and nothing else of Notes. It is
 * the small door the Book page asks (components/notes/BookSection.vue): the big store (stores/notes.ts, with the send queue and the chat layer) stays out of the page, and
 * so does the repository (`data/notes.ts`), loaded by a dynamic `import()` the first time she opens a Book page. Read when the page opens, fresh each time (no Realtime,
 * no cache that could show what she may no longer see); nothing is asked while she is offline or signed out.
 */
export const useNotesSummaryStore = defineStore('notesSummary', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const online = useOnline()

  const summaries = ref<Record<string, NotesSummary>>({})
  const me = computed(() => session.member?.id ?? null)
  let epoch = 0

  /** Reads the lines of a Book; keeps what it had when it cannot. */
  async function load(bookId: string): Promise<void> {
    if (!me.value || !backend || !online.value) return
    const member = me.value
    const since = epoch
    const { createNotes } = await import('~/data/notes')
    const answer = await createNotes(backend, { online: isOnline }).summary(bookId)
    if (since !== epoch || me.value !== member || answer.error) return
    summaries.value[bookId] = answer.data
  }

  const of = (bookId: string | null | undefined): NotesSummary | null => (bookId ? (summaries.value[bookId] ?? null) : null)

  function reset() {
    epoch++
    summaries.value = {}
  }
  watch(me, (now, before) => {
    if (before && now !== before) reset()
  })

  return { summaries, load, of, reset }
})
