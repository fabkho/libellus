import { describe, expect, it } from 'vitest'
import { isUnverified, shownBook } from '../app/utils/unverifiedBook'
import { socialBookFromJson } from '../app/data/socialShapes'
import { canWantToRead } from '../app/utils/wantToRead'

const normal = {
  id: 'a',
  title: 'Dune',
  authors: ['Frank Herbert'],
  coverUrl: 'https://x/c.jpg',
  coverThumbhash: 'th',
  coverColors: { dominant: '#111', secondary: '#222' },
}

describe('unverified Book', () => {
  it('is told by the flag', () => {
    expect(isUnverified({ unverified: true })).toBe(true)
    expect(isUnverified({})).toBe(false)
    expect(isUnverified(null)).toBe(false)
  })

  it('shows as the one string with no authors and no cover', () => {
    expect(shownBook({ ...normal, unverified: true }, 'Outside the catalogue')).toEqual({
      id: 'a',
      title: 'Outside the catalogue',
      authors: [],
      coverUrl: null,
      coverThumbhash: null,
      coverColors: null,
      unverified: true,
    })
  })

  it('leaves a normal Book alone', () => {
    expect(shownBook(normal, 'Outside the catalogue')).toBe(normal)
  })

  it('reads from the database JSON', () => {
    const json = {
      id: 'b', title: null, authors: [], published_year: null, cover_url: null, cover_thumbhash: null,
      cover_dominant: null, cover_secondary: null, description: null, unverified: true,
    } as unknown as Parameters<typeof socialBookFromJson>[0]
    const book = socialBookFromJson(json)
    expect(book).toMatchObject({ id: 'b', title: '', authors: [], coverUrl: null, unverified: true, manual: false })
    expect(socialBookFromJson({ ...json, title: 'Dune', unverified: undefined } as never).unverified).toBe(false)
  })
})

describe('Want to read', () => {
  it('is not offered on an unverified Book (nothing to keep), nor a Manual one, nor one she has', () => {
    expect(canWantToRead({ manual: false }, null)).toBe(true)
    expect(canWantToRead({ manual: false, unverified: true }, null)).toBe(false)
    expect(canWantToRead({ manual: true }, null)).toBe(false)
    expect(canWantToRead({ manual: false }, { status: 'reading' })).toBe(false)
  })
})
