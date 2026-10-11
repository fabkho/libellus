import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { bookCardPath, createReadingPages, readingPagePath, READING_PAGE_TOKEN } from '@/data/readingPage'
import { isoDay } from '@/utils/dates'
import { copyLink, shareLink } from '@/utils/shareLink'
import { signUpMember } from './support/member'
import { newClient, runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Share with friends (issue #171), through the repository against the local
 * stack: she turns her page on and gets an address; anyone, signed out, reads
 * only the sections she left on; a new link or turning it off kills the old
 * address; a Book she shares has a card, with her review only when she says so.
 * The rules themselves are the database's (supabase/tests/reading_pages_test.sql).
 */

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount: 250,
    year: 1969,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    // A host the app's covers really come from: a reading page hands out a cover only from those (social v1, S1).
    coverUrl: 'https://covers.openlibrary.org/b/id/8231856-L.jpg',
    coverThumbhash: null,
    coverColors: { dominant: '#112233', secondary: '#445566' },
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

async function memberWithBooks() {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const today = isoDay()
  const finished = (await library.addToLibrary(book('Finished Well'), { status: 'finished', startedOn: today, endedOn: today, rating: 18, review: 'A review of mine' })).data!
  const wanted = (await library.addToLibrary(book('Wanted Later'))).data!
  return { member, finished, wanted, pages: createReadingPages(member.client) }
}

describe('her reading page', () => {
  it('is off until she turns it on, then has an address', async () => {
    const { pages } = await memberWithBooks()
    expect((await pages.settings()).data).toEqual({ token: null, sections: { reading: true, year: true, favourites: true, finished: true, shelf: true } })

    const on = (await pages.setOn(true)).data!
    expect(on.token).toMatch(READING_PAGE_TOKEN)
    expect(readingPagePath(on.token!)).toBe(`/r/${on.token}`)
    expect((await pages.settings()).data!.token).toBe(on.token)
  })

  it('shows anyone, signed out, the sections she left on and nothing else', async () => {
    const { pages, finished } = await memberWithBooks()
    const { token } = (await pages.setOn(true)).data!
    const visitor = createReadingPages(newClient())

    const page = (await visitor.publicPage(token!)).data!
    expect(page.finished?.[0]).toMatchObject({ book: { title: finished.book.title, coverColors: { dominant: '#112233', secondary: '#445566' } }, rating: 18, review: null })
    expect(page.favourites?.map((f) => f.book.title)).toEqual([finished.book.title])
    expect(page.year?.books).toBe(1)
    expect(page.shelf).toEqual({ kind: 'covers', books: [expect.objectContaining({ title: finished.book.title })] })

    await pages.setSections({ finished: false, shelf: false })
    const fewer = (await visitor.publicPage(token!)).data!
    expect(fewer.finished).toBeUndefined()
    expect(fewer.shelf).toBeUndefined()
    expect(fewer.sections).toMatchObject({ finished: false, shelf: false, favourites: true })
  })

  it('is gone at its old address after a new link, and entirely once off', async () => {
    const { pages } = await memberWithBooks()
    const first = (await pages.setOn(true)).data!.token!
    const second = (await pages.renewLink()).data!.token!
    const visitor = createReadingPages(newClient())

    expect(second).not.toBe(first)
    expect((await visitor.publicPage(first)).data).toBeNull()
    expect((await visitor.publicPage(second)).data).not.toBeNull()

    await pages.setOn(false)
    expect((await visitor.publicPage(second)).data).toBeNull()
    expect((await pages.renewLink()).error).toBe('reading_page_off')
  })
})

describe('a Book card', () => {
  it('exists for a Book she shares, with her review only when she says so', async () => {
    const { pages, finished, wanted } = await memberWithBooks()
    const visitor = createReadingPages(newClient())
    expect((await pages.shareBook(wanted.book.id, false)).error).toBe('reading_page_off')

    const { token } = (await pages.setOn(true)).data!
    expect((await visitor.publicCard(token!, wanted.book.id)).data).toBeNull()

    expect((await pages.shareBook(wanted.book.id, false)).data).toEqual({ bookId: wanted.book.id, review: false })
    expect((await visitor.publicCard(token!, wanted.book.id)).data).toMatchObject({ status: 'want_to_read', book: { title: wanted.book.title } })
    expect(bookCardPath(token!, wanted.book.id)).toBe(`/r/${token}/book/${wanted.book.id}`)

    expect((await visitor.publicCard(token!, finished.book.id)).data).toMatchObject({ rating: 18, review: null })
    await pages.shareBook(finished.book.id, true)
    expect((await pages.sharedBook(finished.book.id)).data).toEqual({ bookId: finished.book.id, review: true })
    expect((await visitor.publicCard(token!, finished.book.id)).data!.review).toBe('A review of mine')
    expect((await visitor.publicPage(token!)).data!.finished![0]!.review).toBe('A review of mine')

    await pages.unshareBook(wanted.book.id)
    expect((await pages.sharedBook(wanted.book.id)).data).toBeNull()
    expect((await visitor.publicCard(token!, wanted.book.id)).data).toBeNull()
  })

  it('is nothing for an address of the wrong shape, without asking', async () => {
    const visitor = createReadingPages(newClient())
    expect(await visitor.publicPage('nope')).toEqual({ data: null, error: null })
    expect(await visitor.publicCard('AAAAAAAAAAAAAAAAAAAAAA', 'not-a-uuid')).toEqual({ data: null, error: null })
  })

  it('refuses writes offline before sending anything', async () => {
    const { member, wanted } = await memberWithBooks()
    const offline = createReadingPages(member.client, { online: () => false })
    expect((await offline.setOn(true)).error).toBe('offline')
    expect((await offline.shareBook(wanted.book.id, true)).error).toBe('offline')
  })
})

describe('handing a link over', () => {
  const link = { url: 'https://libellus.example/r/AAAAAAAAAAAAAAAAAAAAAA', title: 'A page' }

  it('opens the share sheet where there is one', async () => {
    const shared: unknown[] = []
    expect(await shareLink(link, { share: async (data) => void shared.push(data) })).toBe('shared')
    expect(shared).toEqual([link])
  })

  it('is nothing more when the sheet is dismissed, and the clipboard when it cannot open', async () => {
    const copied: string[] = []
    const clipboard = { writeText: async (text: string) => void copied.push(text) }
    const abort = Object.assign(new Error('dismissed'), { name: 'AbortError' })
    expect(await shareLink(link, { share: () => Promise.reject(abort), clipboard })).toBe('cancelled')
    expect(await shareLink(link, { share: () => Promise.reject(new Error('NotAllowedError')), clipboard })).toBe('copied')
    expect(await shareLink(link, { clipboard })).toBe('copied')
    expect(copied).toEqual([link.url, link.url])
    expect(await copyLink(link.url, {})).toBe('failed')
  })
})
