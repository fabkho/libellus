import { defineStore } from 'pinia'
import type { Book, BookSnapshot } from '~/data/books'
import { createGoodreads, goodreadsKey, type Goodreads, type GoodreadsRating } from '~/data/goodreads'
import { useSessionStore } from '~/stores/session'

/**
 * The Goodreads line on the book page (issue #69), by ISBN-13 (by title and
 * first author for a Book without one): what the
 * `goodreads-rating` function answered on this device since the app started.
 * Until it answers (and offline, and when it fails) a Book shows the rating
 * its row carried, if any: a Library entry's Book has it from the last load,
 * kept for offline. A Book with neither an ISBN nor an author never asks.
 */
export const useGoodreadsStore = defineStore('goodreads', () => {
  const backend = useBackend()

  let repository: Goodreads | null = null
  function goodreads(): Goodreads | null {
    if (!backend) return null
    repository ??= createGoodreads(backend, { online: isOnline })
    return repository
  }

  /** Answers by `goodreadsKey` (ISBN-13, else title and first author); null: Goodreads does not know it. */
  const answers = reactive(new Map<string, GoodreadsRating | null>())
  const asking = new Map<string, Promise<void>>()

  /** The rating to show for a Book: the latest answer, else what its row carried. */
  function rating(book: Book | BookSnapshot): GoodreadsRating | null {
    const key = goodreadsKey(book)
    if (!key) return null
    if (answers.has(key)) return answers.get(key) ?? null
    return ('goodreads' in book ? book.goodreads : null) ?? null
  }

  /** Asks once per Book (by key) and app run; offline or on a failure the Book keeps what it had. */
  function load(book: Book | BookSnapshot): Promise<void> {
    const key = goodreadsKey(book)
    const repo = goodreads()
    if (!key || !repo || answers.has(key) || !isOnline()) return Promise.resolve()
    const running = asking.get(key)
    if (running) return running
    const task = repo
      .rating(book)
      .then((result) => {
        if (!result.error) answers.set(key, result.data)
      })
      .finally(() => asking.delete(key))
    asking.set(key, task)
    return task
  }

  // Shared data, but the answers are cheap to ask again: start afresh per member.
  const session = useSessionStore()
  watch(
    () => session.member?.id,
    (now, before) => {
      if (now !== before) {
        answers.clear()
        asking.clear()
      }
    },
  )

  return { rating, load }
})
