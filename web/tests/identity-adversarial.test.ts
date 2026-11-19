import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { isNearWork, isSameWork, sameAuthor } from '@/data/import/editions'

/**
 * The same-work rule's two silent holes: a found title whose bracketed aside or trailing segment says it is not the
 * one book alone (a box set, an omnibus, an anniversary edition, a film's tie-in), and a row the file gives no author
 * for, which matched any book with a form of its title. Plus the spelled-out volume mark the rule read as part of the
 * title (`Book Two` next to `Book 2`). Invented titles and authors throughout; pure.
 */

/** What a source found: the fields the same-work rule looks at. */
type FoundBook = Pick<BookSnapshot, 'title' | 'authors' | 'language' | 'pageCount' | 'year' | 'source'> & {
  coverUrl?: string | null
}
type Found = { id: string; book: FoundBook }

const book = (id: string, overrides: Partial<FoundBook> = {}): Found => ({
  id,
  book: {
    title: 'Ember Road',
    authors: ['Tove Lindqvist'],
    language: null,
    pageCount: null,
    year: null,
    source: 'openlibrary',
    coverUrl: null,
    ...overrides,
  },
})

/** The row of the file: its title and its authors (empty when the file gives none). */
const row = (title: string, authors: string[] = ['Tove Lindqvist']) => ({ title, authors })
const same = (title: string, found: Found, authors: string[] = ['Tove Lindqvist']) => isSameWork(row(title, authors), found.book)

describe('not the one book alone: a set, an omnibus, a reissue with extras, an adaptation', () => {
  it('does not take a boxed set or an omnibus of the work for the work', () => {
    expect(same('Ember Road', book('set', { title: 'Ember Road (Box Set)' }))).toBe(false)
    expect(same('Ember Road', book('boxed', { title: 'Ember Road (Boxed Set)' }))).toBe(false)
    expect(same('Ember Road', book('omnibus', { title: 'Ember Road (Omnibus)' }))).toBe(false)
  })

  it('does not take a collection, a bundle or an anthology of the work for the work', () => {
    expect(same('Ember Road', book('collection', { title: 'Ember Road (Collection)' }))).toBe(false)
    expect(same('Ember Road', book('bundle', { title: 'Ember Road (Bundle)' }))).toBe(false)
    expect(same('Ember Road', book('anthology', { title: 'Ember Road (Anthology)' }))).toBe(false)
  })

  it('does not take an adaptation of the work for the work', () => {
    expect(same('Ember Road', book('tie-in', { title: 'Ember Road (Movie Tie-in)' }))).toBe(false)
    expect(same('Ember Road', book('tie-in-edition', { title: 'Ember Road (Tie-in Edition)' }))).toBe(false)
  })

  it('does not take a reissue with extras for the edition the row names', () => {
    expect(same('Ember Road', book('anniversary', { title: 'Ember Road (Anniversary Edition)' }))).toBe(false)
  })

  it('does not take it through a trailing segment either, not only a bracketed aside', () => {
    expect(same('Ember Road', book('trailing-omnibus', { title: 'Ember Road: Omnibus' }))).toBe(false)
    expect(same('Ember Road', book('trailing-anniversary', { title: 'Ember Road - Anniversary Edition' }))).toBe(false)
  })

  it('still takes an edition note that says nothing about what the book is', () => {
    // The code's own answer: `DESCRIPTOR` (data/titleMatch.ts) counts an illustrated edition among the notes a title
    // may end on without saying anything about the book. Kept: same text, same work, a different printing.
    expect(same('Ember Road', book('illustrated', { title: 'Ember Road (Illustrated Edition)' }))).toBe(true)
  })

  it('takes the row that is itself the marked thing', () => {
    expect(same('Ember Road (Box Set)', book('set', { title: 'Ember Road (Box Set)' }))).toBe(true)
    expect(same('Ember Road: Study Guide', book('guide', { title: 'Ember Road: Study Guide' }))).toBe(true)
  })

  it('does not over-tighten: a dash subtitle, a series prefix, a series aside, a translation aside', () => {
    expect(same('Cold Water', book('subtitle', { title: 'Cold Water - Eine Liebe am Meer' }))).toBe(true)
    expect(same('Harbour Lights - Cold Water', book('prefix', { title: 'Cold Water' }))).toBe(true)
    expect(same('Cold Water', book('series', { title: 'Cold Water (Harbour Lights, #1)' }))).toBe(true)
    // A translation whose brackets name the work (unchanged: the other script's rule refuses it, the aside is not a set's).
    expect(same('Cold Water', book('translated', { title: 'Θνητοί Θεοί (Cold Water)' }))).toBe(false)
    expect(same('Cold Water', book('known-work', { title: 'Θνητοί Θεοί (Altered Carbon)' }))).toBe(false)
  })
})

describe('a row the file gives no author for matches nobody on a form of its title', () => {
  it('does not take a form of the title for the book, only the full title', () => {
    // The file names a generic title, no one to tell the books apart: the tail of another book's title is not it.
    expect(isSameWork(row('Small Hours', []), book('tail', { title: 'Harbour Lights - Small Hours' }).book)).toBe(false)
    expect(isSameWork(row('Small Hours', []), book('main', { title: 'Small Hours: A Novel' }).book)).toBe(false)
  })

  it('still takes the same full title', () => {
    expect(isSameWork(row('Cold Water', []), book('same', { title: 'Cold Water', authors: ['Anna Bramley'] }).book)).toBe(true)
    // …the series aside is dropped from the full title, so this is the same one too.
    expect(isSameWork(row('Cold Water', []), book('series', { title: 'Cold Water (Harbour Lights, #1)' }).book)).toBe(true)
  })

  it('does not take a head, a tail or a near miss, and leaves it to isNearWork', () => {
    const found = book('subtitle', { title: 'Cold Water - Eine Liebe am Meer' })
    expect(isSameWork(row('Cold Water', []), found.book)).toBe(false)
    expect(isNearWork(row('Cold Water', []), found.book)).toBe(true)
  })
})

describe('a spelled-out volume mark is dropped from the title like a digit', () => {
  it('takes a spelled-out volume of the row’s book as the row’s book', () => {
    expect(same('Cold Water Book Two', book('plain', { title: 'Cold Water' }))).toBe(true)
    expect(same('Cold Water Book Two', book('digits', { title: 'Cold Water Book 2' }))).toBe(true)
  })

  it('still refuses another volume, spelled out or not', () => {
    expect(same('Cold Water Book Two', book('three', { title: 'Cold Water Book Three' }))).toBe(false)
    expect(same('Cold Water Book Two', book('digits', { title: 'Cold Water Book 3' }))).toBe(false)
  })

  it('reads the words NUMBER_WORDS knows, not a list of its own', () => {
    expect(same('Kaltes Wasser Band Zwei', book('zwei', { title: 'Kaltes Wasser' }))).toBe(true)
    expect(same('Cold Water Book Two', book('set', { title: 'Cold Water Book Two (Box Set)' }))).toBe(false)
  })
})

describe('sameAuthor’s typo tolerance (measured, unchanged)', () => {
  it('takes a surname one letter off with the same initial, which merges Clark and Clarke', () => {
    // The tolerance exists for a file that misspells an author; the fixture corpus cannot show it is unnecessary,
    // so it stays (see the report).
    expect(sameAuthor('Sarah Clark', 'Sarah Clarke')).toBe(true)
    expect(sameAuthor('Greta Müller', 'Greta Mueller')).toBe(true)
  })
})
