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

  it('takes its stored copy too (a key beside no cover is not shown), and adds none where the Book carries none', () => {
    const copy = { ...normal, coverKey: 'c0ffeec0ffeec0ffeec0ffeec0ffeec0', coverWidths: [120, 240], unverified: true }
    expect(shownBook(copy, 'Outside')).toMatchObject({ coverUrl: null, coverKey: null, coverWidths: null })
    expect('coverKey' in shownBook({ ...normal, unverified: true }, 'Outside')).toBe(false)
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

  it('reads the stored copy of a social answer: both keys always, null when hidden, not stored or an older answer', () => {
    const key = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0'
    const json = { id: 'b', title: 'Dune', authors: [], published_year: 1965, cover_url: 'https://x/c.jpg', cover_thumbhash: null, cover_dominant: null, cover_secondary: null, manual: false }
    expect(socialBookFromJson({ ...json, cover_key: key, cover_widths: [240, 120, 120] } as never)).toMatchObject({ coverKey: key, coverWidths: [120, 240] })
    expect(socialBookFromJson({ ...json, cover_key: null, cover_widths: null } as never)).toMatchObject({ coverKey: null, coverWidths: null })
    expect(socialBookFromJson(json as never)).toMatchObject({ coverKey: null, coverWidths: null })
    expect(socialBookFromJson({ ...json, cover_key: 'DROP TABLE', cover_widths: [240] } as never)).toMatchObject({ coverKey: null, coverWidths: null })
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
