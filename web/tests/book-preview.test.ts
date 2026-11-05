import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkCard } from '@/data/enrich/works'
import { forgetPreviews, previewFromBook, previewFromWork, previewOf, PREVIEWS_KEPT, rememberPreview } from '@/utils/bookPreview'

/**
 * What the Book page shows of a Book in its first frame (utils/bookPreview.ts): whatever the link that opened
 * it already knew, handed over on the touch-down and read once by the page.
 */
const work = (over: Partial<WorkCard> = {}): WorkCard => ({
  title: 'The Wise Man’s Fear',
  year: 2011,
  position: 2,
  coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Pub/a/600x900bb.jpg',
  coverKey: 'abc123',
  coverWidths: [200, 400],
  edition: { title: 'The Wise Man’s Fear', isbn13: '9780756407919', openlibrary_edition_key: null, cover_url: null },
  ...over,
})

beforeEach(() => forgetPreviews())

describe('the book preview cache', () => {
  it('hands over what a list knew, by the key its link opens', () => {
    rememberPreview('isbn-9780756407919', previewFromWork(work(), { name: 'The Kingkiller Chronicle', position: '2', count: 3 }))
    const preview = previewOf('isbn-9780756407919')
    expect(preview).toMatchObject({
      title: 'The Wise Man’s Fear',
      coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Pub/a/600x900bb.jpg',
      coverKey: 'abc123',
      coverWidths: [200, 400],
      series: { name: 'The Kingkiller Chronicle', position: '2', count: 3 },
      identity: '9780756407919',
    })
    expect(previewOf('isbn-9780000000000')).toBeNull()
  })

  it('never shows the work’s year as the edition’s, nor guesses authors or pages', () => {
    const preview = previewFromWork(work())
    expect(preview).not.toHaveProperty('year')
    expect(preview.authors).toEqual([])
    expect(preview.pageCount).toBeUndefined()
  })

  it('takes everything a card that carries the Book has: authors, page count, the cover with its blur and colours', () => {
    const preview = previewFromBook({
      id: 'b1',
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      coverUrl: 'https://example.test/p.jpg',
      coverThumbhash: 'hash',
      coverColors: { dominant: '#112233', secondary: '#445566' },
      pageCount: 272,
    })
    expect(preview).toMatchObject({
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      pageCount: 272,
      coverThumbhash: 'hash',
      coverColors: { dominant: '#112233', secondary: '#445566' },
      identity: 'b1',
    })
  })

  it('keeps an ISBN as the identity of a cover before the Book’s id', () => {
    expect(previewFromBook({ id: 'b1', title: 'T', authors: [], isbn13: '9780756407919' }).identity).toBe('9780756407919')
  })

  it('remembers nothing without a key or a title, and the last hand-over for a key wins', () => {
    rememberPreview(null, previewFromWork(work()))
    rememberPreview('k', null)
    rememberPreview('k', { title: '', authors: [], coverUrl: null })
    expect(previewOf('k')).toBeNull()
    rememberPreview('k', previewFromWork(work({ title: 'One' })))
    rememberPreview('k', previewFromWork(work({ title: 'Two' })))
    expect(previewOf('k')?.title).toBe('Two')
  })

  it('keeps the last previews handed over and lets the oldest go', () => {
    for (let i = 0; i <= PREVIEWS_KEPT; i++) rememberPreview(`k${i}`, previewFromWork(work({ title: `T${i}` })))
    expect(previewOf('k0')).toBeNull()
    expect(previewOf('k1')?.title).toBe('T1')
    expect(previewOf(`k${PREVIEWS_KEPT}`)?.title).toBe(`T${PREVIEWS_KEPT}`)
    // Handing a key over again makes it the newest: it outlives the ones before it.
    rememberPreview('k1', previewFromWork(work({ title: 'again' })))
    rememberPreview('extra', previewFromWork(work()))
    expect(previewOf('k1')?.title).toBe('again')
    expect(previewOf('k2')).toBeNull()
  })

  it('forgets them all for the next member', () => {
    rememberPreview('k', previewFromWork(work()))
    forgetPreviews()
    expect(previewOf('k')).toBeNull()
  })
})
