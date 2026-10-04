import { defineStore } from 'pinia'
import type { Book, BookSnapshot } from '~/data/books'
import { createGoodreads, goodreadsIsbn, type Goodreads, type GoodreadsRating } from '~/data/goodreads'
import { useSessionStore } from '~/stores/session'

/**
 * The Goodreads line on the book page (issue #69), by ISBN-13: what the
 * `goodreads-rating` function answered on this device since the app started.
 * Until it answers (and offline, and when it fails) a Book shows the rating
 * its row carried, if any: a Library entry's Book has it from the last load,
 * kept for offline. A Book without an ISBN never asks.
 */
export const useGoodreadsStore = defineStore('goodreads', () => {
  const backend = useBackend()

  let repository: Goodreads | null = null
  function goodreads(): Goodreads | null {
    if (!backend) return null
    repository ??= createGoodreads(backend, { online: isOnline })
    return repository
  }

  /** Answers by ISBN-13; null: Goodreads does not know it. */
  const answers = reactive(new Map<string, GoodreadsRating | null>())
  const asking = new Map<string, Promise<void>>()

  /** The rating to show for a Book: the latest answer, else what its row carried. */
  function rating(book: Book | BookSnapshot): GoodreadsRating | null {
    const isbn13 = goodreadsIsbn(book)
    if (!isbn13) return null
    if (answers.has(isbn13)) return answers.get(isbn13) ?? null
    return ('goodreads' in book ? book.goodreads : null) ?? null
  }

  /** Asks once per ISBN and app run; offline or on a failure the Book keeps what it had. */
  function load(book: Book | BookSnapshot): Promise<void> {
    const isbn13 = goodreadsIsbn(book)
    const repo = goodreads()
    if (!isbn13 || !repo || answers.has(isbn13) || !isOnline()) return Promise.resolve()
    const running = asking.get(isbn13)
    if (running) return running
    const task = repo
      .rating(book)
      .then((result) => {
        if (!result.error) answers.set(isbn13, result.data)
      })
      .finally(() => asking.delete(isbn13))
    asking.set(isbn13, task)
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
