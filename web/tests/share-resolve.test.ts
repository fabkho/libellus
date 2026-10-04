import { afterAll, describe, expect, it } from 'vitest'
import { createSearch, type FetchLike } from '@/data/search'
import { isbnOfGoodreadsId, resolveShare } from '@/data/shareResolve'
import { parseShared } from '@/utils/shared'
import { appleAnswer } from './support/apple'
import { signUpMember } from './support/member'
import { sql } from './support/stack'
import { openLibraryAnswer } from './support/openLibrary'

/**
 * Where a share leads (issue #91), through the search repository on the
 * recorded Apple Books and OpenLibrary answers (never the live APIs).
 */
const recorded = (async (input: string) => {
  const url = new URL(input)
  const body = url.hostname === 'itunes.apple.com' ? appleAnswer(url) : openLibraryAnswer(url)
  return { ok: true, status: 200, json: async () => body }
}) as FetchLike

const search = createSearch({ fetch: recorded, languages: ['de-DE'] })

describe('resolveShare', () => {
  it('goes to the Book an ISBN names', async () => {
    const outcome = await resolveShare(parseShared({ url: 'https://www.thalia.de/shop/x?ISBN=9783641264864' }), { search })
    expect(outcome.kind).toBe('book')
    if (outcome.kind === 'book') expect(outcome.book.title).toMatch(/Piranesi/i)
  })

  it('goes to the Book a Goodreads link names when a hit bears its title', async () => {
    const shared = parseShared({ text: 'Klara und die Sonne by Kazuo Ishiguro https://www.goodreads.com/book/show/54120408' })
    const outcome = await resolveShare({ ...shared, query: 'Klara und die Sonne' }, { search })
    expect(outcome.kind).toBe('book')
  })

  it('opens the search with the words when only a title was shared', async () => {
    expect(await resolveShare(parseShared({ text: 'Klara und die Sonne' }), { search })).toEqual({ kind: 'search', query: 'Klara und die Sonne' })
  })

  it('opens the search when the ISBN is unknown to every source', async () => {
    const outcome = await resolveShare(parseShared({ title: 'Some book', url: 'https://example.com/b?isbn=9780306406157' }), { search })
    expect(outcome).toEqual({ kind: 'search', query: 'Some book' })
  })

  it('opens the search with the ISBN when nothing else was shared and nothing answers', async () => {
    const failing = createSearch({ fetch: (async () => ({ ok: false, status: 503, json: async () => ({}) })) as FetchLike, languages: ['de-DE'] })
    expect(await resolveShare(parseShared({ text: '9780306406157' }), { search: failing })).toEqual({ kind: 'search', query: '9780306406157' })
  })
})

describe('the Goodreads cache', () => {
  const isbn = '9791234567896'
  afterAll(async () => {
    await sql('delete from public.goodreads_ratings where isbn13 = $1', [isbn])
  })

  it('gives the ISBN a member’s Goodreads id was cached under, and nothing for an id nobody looked up', async () => {
    const goodreadsId = String(800_000_000 + Math.floor(Math.random() * 99_000_000))
    await sql(
      `insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count, reviews_count)
       values ($1, 'found', 'isbn', $2, 4.1, 1000, 100) on conflict (isbn13) do update set goodreads_id = excluded.goodreads_id`,
      [isbn, goodreadsId],
    )
    const { client } = await signUpMember()
    expect(await isbnOfGoodreadsId(client, goodreadsId)).toBe(isbn)
    expect(await isbnOfGoodreadsId(client, '1')).toBeNull()
    // The id leads to the ISBN, which no recorded source knows: the search opens with the words.
    const shared = parseShared({ text: `Some Title by Some One https://www.goodreads.com/book/show/${goodreadsId}` })
    expect(await resolveShare(shared, { search, client })).toEqual({ kind: 'search', query: 'Some Title Some One' })
  })
})
