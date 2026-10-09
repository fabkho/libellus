import { afterAll, describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createGoodreads, goodreadsIsbn, goodreadsKey, goodreadsUrl, ratingFromRow, showsRating, type FunctionsClient } from '@/data/goodreads'
import { createLibrary } from '@/data/library'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Goodreads' rating on the book page (issue #69). The repository asks the
 * `goodreads-rating` edge function, which is never called here: a stand-in
 * for `functions.invoke` answers what the function answers
 * (supabase/functions/goodreads-rating has its own tests, on recorded Goodreads
 * responses). Then the cache as a member sees it, on the local stack: a
 * Library entry's Book carries its ISBN's found rating, a miss is no rating,
 * and a member cannot write the cache.
 */

function book(overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: runTitle('Small Gods'),
    authors: ['Terry Pratchett'],
    isbn13: '9780061803208',
    isbn10: null,
    pageCount: 400,
    year: 2009,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

/** A `functions.invoke` that answers with `answer` and remembers what it was asked. */
function functions(answer: () => { data: unknown; error: unknown } | Promise<never>) {
  const asked: { name: string; body: unknown }[] = []
  const client: FunctionsClient = {
    functions: {
      invoke: async (name, { body }) => {
        asked.push({ name, body })
        return answer()
      },
    },
  }
  return { client, asked }
}

describe('the repository', () => {
  it('asks the function by ISBN-13 with the title and authors, and reads a found rating', async () => {
    const { client, asked } = functions(() => ({
      data: { status: 'found', goodreadsId: '6388978', rating: 4.32, ratingsCount: 137875, reviewsCount: 6116, matchedBy: 'isbn' },
      error: null,
    }))
    const result = await createGoodreads(client).rating(book({ title: 'Small Gods' }))
    expect(result).toEqual({
      data: { goodreadsId: '6388978', rating: 4.32, ratingsCount: 137875, reviewsCount: 6116 },
      error: null,
    })
    expect(asked).toEqual([
      { name: 'goodreads-rating', body: { isbn13: '9780061803208', title: 'Small Gods', authors: ['Terry Pratchett'] } },
    ])
  })

  it('reads a miss as no rating, and a rating found by title without a review count', async () => {
    const miss = functions(() => ({ data: { status: 'not_found', checkedAt: '2026-10-04T10:00:00Z' }, error: null }))
    expect(await createGoodreads(miss.client).rating(book())).toEqual({ data: null, error: null })

    const byTitle = functions(() => ({
      data: { status: 'found', goodreadsId: '32109569', rating: 4.24, ratingsCount: 146833, reviewsCount: null },
      error: null,
    }))
    expect((await createGoodreads(byTitle.client).rating(book())).data?.reviewsCount).toBeNull()
  })

  it('asks with the ISBN-10 converted, and not at all offline', async () => {
    const { client, asked } = functions(() => ({ data: { status: 'not_found' }, error: null }))
    await createGoodreads(client).rating(book({ isbn13: null, isbn10: '0061803200' }))
    expect((asked[0]!.body as { isbn13: string }).isbn13).toBe('9780061803208')

    expect(await createGoodreads(client, { online: () => false }).rating(book())).toEqual({ data: null, error: 'offline' })
    expect(await createGoodreads(client, { online: () => false }).rating(book({ isbn13: null }))).toEqual({
      data: null,
      error: 'offline',
    })
    expect(asked).toHaveLength(1)
  })

  it('asks for a Book without an ISBN by its title and authors alone', async () => {
    const { client, asked } = functions(() => ({
      data: { status: 'found', goodreadsId: '32109569', rating: 4.24, ratingsCount: 146833, reviewsCount: null, matchedBy: 'title' },
      error: null,
    }))
    const wicked = book({ isbn13: null, isbn10: null, title: 'Something Wicked This Way Comes', authors: ['Ray Bradbury'] })
    expect(await createGoodreads(client).rating(wicked)).toEqual({
      data: { goodreadsId: '32109569', rating: 4.24, ratingsCount: 146833, reviewsCount: null },
      error: null,
    })
    // No `isbn13` key at all: the function reads that as "look it up by title and author".
    expect(asked).toEqual([
      { name: 'goodreads-rating', body: { title: 'Something Wicked This Way Comes', authors: ['Ray Bradbury'] } },
    ])
  })

  it('does not ask for a Book with no ISBN and no author (a title alone never matches)', async () => {
    const { client, asked } = functions(() => ({ data: { status: 'not_found' }, error: null }))
    expect(await createGoodreads(client).rating(book({ isbn13: null, authors: [] }))).toEqual({ data: null, error: null })
    expect(asked).toHaveLength(0)
  })

  it('remembers a Book by its ISBN-13, else by title and first author; nothing to ask with is no key', () => {
    expect(goodreadsKey({ isbn13: '9780061803208', isbn10: null, title: 'Small Gods', authors: [] })).toBe('9780061803208')
    expect(goodreadsKey({ isbn13: null, isbn10: '0061803200', title: 'Small Gods', authors: [] })).toBe('9780061803208')
    const wicked = { isbn13: null, isbn10: null, title: 'Something Wicked This Way Comes', authors: ['Ray Bradbury', 'Other'] }
    expect(goodreadsKey(wicked)).toBe('title:something wicked this way comes|ray bradbury')
    // The same title twice in the Catalogue is one question.
    expect(goodreadsKey({ ...wicked, title: ' something wicked this way comes ' })).toBe(goodreadsKey(wicked))
    expect(goodreadsKey({ ...wicked, authors: [] })).toBeNull()
    expect(goodreadsKey({ ...wicked, authors: ['  '] })).toBeNull()
  })

  it('a failing function is "unavailable", never a miss', async () => {
    const failing = functions(() => ({ data: null, error: new Error('FunctionsHttpError') }))
    expect(await createGoodreads(failing.client).rating(book())).toEqual({ data: null, error: 'unavailable' })
    const throwing = functions(() => Promise.reject(new Error('network')))
    expect(await createGoodreads(throwing.client).rating(book())).toEqual({ data: null, error: 'unavailable' })
    const garbled = functions(() => ({ data: '<html>', error: null }))
    expect(await createGoodreads(garbled.client).rating(book())).toEqual({ data: null, error: 'unavailable' })
  })

  it('links to the reviews on Goodreads, and shows only a rating somebody gave', () => {
    expect(goodreadsUrl('6388978')).toBe('https://www.goodreads.com/book/show/6388978#CommunityReviews')
    expect(goodreadsIsbn({ isbn13: null, isbn10: null })).toBeNull()
    expect(showsRating({ goodreadsId: '1', rating: 0, ratingsCount: 0, reviewsCount: 0 })).toBe(false)
    expect(showsRating(null)).toBe(false)
    expect(
      ratingFromRow({
        isbn13: '9780061803208',
        status: 'found',
        goodreads_id: '6388978',
        rating: '4.32',
        ratings_count: 137875,
        reviews_count: 6116,
        checked_at: '2026-10-04T10:00:00Z',
      }),
    ).toEqual({ goodreadsId: '6388978', rating: 4.32, ratingsCount: 137875, reviewsCount: 6116 })
  })
})

describe('the cache, as a member sees it', () => {
  const isbns: string[] = []
  afterAll(async () => {
    await sql('delete from public.goodreads_ratings where isbn13 = any($1)', [isbns])
  })

  it('a Library entry\'s Book carries its found rating; a miss is none; members cannot write it', async () => {
    const found = await unusedIsbn13()
    const missed = await unusedIsbn13()
    isbns.push(found, missed)
    await sql(
      `insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count, reviews_count)
       values ($1, 'found', 'isbn', '6388978', 4.32, 137875, 6116), ($2, 'not_found', null, null, null, null, null)`,
      [found, missed],
    )

    const ida = await signUpMember()
    const library = createLibrary(ida.client)
    const { data: withRating } = await library.addToLibrary(book({ isbn13: found }))
    const { data: withMiss } = await library.addToLibrary(book({ isbn13: missed, title: runTitle('Unknown') }))

    const { data: entries } = await library.entries('want_to_read')
    const byId = new Map(entries!.map((entry) => [entry.id, entry]))
    expect(byId.get(withRating!.id)!.book.goodreads).toEqual({
      goodreadsId: '6388978',
      rating: 4.32,
      ratingsCount: 137875,
      reviewsCount: 6116,
    })
    expect(byId.get(withMiss!.id)!.book.goodreads).toBeUndefined()
    expect((await library.book(withRating!.book.id)).data?.goodreads?.goodreadsId).toBe('6388978')

    // The rows themselves are readable, and only readable.
    const { data: rows } = await ida.client.from('goodreads_ratings').select('isbn13, status').in('isbn13', [found, missed])
    expect(rows).toHaveLength(2)
    const write = await ida.client
      .from('goodreads_ratings')
      .update({ rating: 1 })
      .eq('isbn13', found)
      .select()
    expect(write.error ?? write.data).toBeTruthy()
    expect(write.data ?? []).toHaveLength(0)
    const [row] = await sql<{ rating: string }>('select rating from public.goodreads_ratings where isbn13 = $1', [found])
    expect(row!.rating).toBe('4.32')
  })
})

/** A valid ISBN-13 no Catalogue Book and no cached rating has yet. */
async function unusedIsbn13(): Promise<string> {
  for (;;) {
    const body = `979${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
    const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
    const isbn = `${body}${(10 - (sum % 10)) % 10}`
    const taken = await sql(
      'select 1 from public.books where isbn13 = $1 union all select 1 from public.goodreads_ratings where isbn13 = $1',
      [isbn],
    )
    if (!taken.length) return isbn
  }
}
