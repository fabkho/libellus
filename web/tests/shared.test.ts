import { describe, expect, it } from 'vitest'
import { mostRecentlyUpdated } from '@/utils/launch'
import { keepShare, peekShare, PENDING_SHARE_KEY, PENDING_SHARE_TTL_MS, takeShare } from '@/utils/pendingShare'
import { cleanSharedText, linksIn, namesTheBook, parseShared } from '@/utils/shared'
import type { DeviceStorage } from '@/data/localData'
import type { LibraryEntry } from '@/data/library'

/**
 * The share target's reader (issue #91): what Android's share sheet hands the
 * app (title, text, url) → an ISBN-13, a Goodreads id and the words to search.
 * Piranesi is 978-1-63557-563-7 (ISBN-10 163557563X).
 */
const PIRANESI = '9781635575637'

describe('parseShared: ISBNs in addresses', () => {
  it('reads an Amazon /dp/ ISBN-10 and converts it', () => {
    const shared = parseShared({ url: 'https://www.amazon.com/Piranesi-Susanna-Clarke/dp/163557563X/ref=sr_1_1?crid=ABC&keywords=piranesi' })
    expect(shared.isbn13).toBe(PIRANESI)
  })

  it('reads /gp/product/ and other Amazon domains', () => {
    expect(parseShared({ url: 'https://www.amazon.de/gp/product/0306406152?psc=1' }).isbn13).toBe('9780306406157')
    expect(parseShared({ url: 'https://www.amazon.co.uk/dp/0743273567' }).isbn13).toBe('9780743273565')
    expect(parseShared({ url: 'https://smile.amazon.com/exec/obidos/ASIN/080442957X/' }).isbn13).toBe('9780804429573')
  })

  it('ignores an ASIN that is not an ISBN (a Kindle edition, a gadget)', () => {
    expect(parseShared({ url: 'https://www.amazon.com/dp/B08FHBV4ZX' }).isbn13).toBeNull()
    // A ten-character ASIN that fails the check digit is not taken for an ISBN-10 either.
    expect(parseShared({ url: 'https://www.amazon.com/dp/0306406153' }).isbn13).toBeNull()
  })

  it('reads the ISBN-13 in the path or in an isbn parameter of a bookstore address', () => {
    expect(parseShared({ url: 'https://www.thalia.de/shop/home/artikeldetails/A1064289449?ISBN=9783641264864' }).isbn13).toBe('9783641264864')
    expect(parseShared({ url: `https://www.bookshop.org/p/books/piranesi/${PIRANESI}?ean=${PIRANESI}` }).isbn13).toBe(PIRANESI)
    expect(parseShared({ url: `https://www.hugendubel.de/de/taschenbuch/titel/${PIRANESI}.html` }).isbn13).toBe(PIRANESI)
    expect(parseShared({ url: 'https://example.com/book?isbn=1635575630&x=1' }).isbn13).toBeNull()
    expect(parseShared({ url: 'https://example.com/book?isbn=163557563X&x=1' }).isbn13).toBe(PIRANESI)
    expect(parseShared({ url: 'https://example.com/b?isbn=978-1-63557-563-7' }).isbn13).toBe(PIRANESI)
  })

  it('refuses an ISBN-13 whose check digit is wrong', () => {
    expect(parseShared({ url: 'https://example.com/book?isbn=9781635575638' }).isbn13).toBeNull()
    expect(parseShared({ text: 'ISBN 9781635575638' }).isbn13).toBeNull()
  })

  it('finds a bare ISBN-10 in the address only where it stands alone', () => {
    expect(parseShared({ url: 'https://www.example.com/book/163557563X' }).isbn13).toBe(PIRANESI)
    expect(parseShared({ url: 'https://www.example.com/book/163557563X/reviews' }).isbn13).toBe(PIRANESI)
    // Part of a longer id: not an ISBN.
    expect(parseShared({ url: 'https://www.example.com/book/a163557563X' }).isbn13).toBeNull()
  })
})

describe('parseShared: ISBNs in text', () => {
  it('reads a raw ISBN-13, with or without hyphens', () => {
    expect(parseShared({ text: PIRANESI }).isbn13).toBe(PIRANESI)
    expect(parseShared({ text: '978-1-63557-563-7' }).isbn13).toBe(PIRANESI)
    expect(parseShared({ text: 'ISBN-13: 978-1-63557-563-7' }).isbn13).toBe(PIRANESI)
  })

  it('reads an ISBN-10 that is labelled or hyphenated, and converts it', () => {
    expect(parseShared({ text: 'ISBN 163557563X' }).isbn13).toBe(PIRANESI)
    expect(parseShared({ text: 'isbn: 1-63557-563-X' }).isbn13).toBe(PIRANESI)
    expect(parseShared({ text: 'ISBN-10: 0743273567' }).isbn13).toBe('9780743273565')
  })

  it('does not take any ten digits with a lucky check digit for an ISBN-10', () => {
    expect(parseShared({ text: 'Call 0743273567 for details' }).isbn13).toBeNull()
    expect(parseShared({ text: 'Order 20260405 shipped' }).isbn13).toBeNull()
  })

  it('reads the ISBN in an Amazon page title', () => {
    const shared = parseShared({ title: 'Amazon.com: Piranesi: 9781635575637: Clarke, Susanna: Books' })
    expect(shared.isbn13).toBe(PIRANESI)
    expect(shared.query).toBe('Piranesi: Clarke, Susanna')
  })

  it('finds the ISBN in a link inside a shared sentence, the way Chrome and the apps send it', () => {
    const text = 'Check out Piranesi on Amazon: https://www.amazon.com/dp/163557563X?ref=x.'
    expect(parseShared({ text }).isbn13).toBe(PIRANESI)
  })

  it('prefers the address over numbers in the text', () => {
    const shared = parseShared({ url: 'https://www.amazon.com/dp/163557563X', text: 'Gatsby 9780743273565' })
    expect(shared.isbn13).toBe(PIRANESI)
  })
})

describe('parseShared: Goodreads', () => {
  it('reads the book id of a Goodreads link and the shared title', () => {
    const shared = parseShared({
      title: 'Piranesi by Susanna Clarke',
      text: 'Check out Piranesi by Susanna Clarke on Goodreads: https://www.goodreads.com/book/show/50202953-piranesi',
    })
    expect(shared.goodreadsId).toBe('50202953')
    expect(shared.isbn13).toBeNull()
    expect(shared.titleHint).toBe('Piranesi')
    // "by" is no word of the book's: a search matches title and author words.
    expect(shared.query).toBe('Piranesi Susanna Clarke')
  })

  it('reads the id when the link comes in `url` or with a locale and a dotted slug', () => {
    expect(parseShared({ url: 'https://www.goodreads.com/en/book/show/50202953.Piranesi?from_search=true' }).goodreadsId).toBe('50202953')
    expect(parseShared({ url: 'https://www.goodreads.com/book/show/50202953' }).goodreadsId).toBe('50202953')
    expect(parseShared({ url: 'https://example.com/book/show/50202953' }).goodreadsId).toBeNull()
  })

  it('falls back to the link’s slug when nothing else names the book', () => {
    const shared = parseShared({ text: 'https://www.goodreads.com/book/show/50202953-piranesi' })
    expect(shared.query).toBe('piranesi')
    expect(shared.titleHint).toBe('piranesi')
  })

  it('takes the page title Chrome sends and drops "| Goodreads"', () => {
    const shared = parseShared({ title: 'Piranesi by Susanna Clarke | Goodreads', text: 'https://www.goodreads.com/book/show/50202953-piranesi' })
    expect(shared.goodreadsId).toBe('50202953')
    expect(shared.query).toBe('Piranesi Susanna Clarke')
  })
})

describe('parseShared: plain text', () => {
  it('is a title search', () => {
    expect(parseShared({ text: 'Klara und die Sonne' })).toEqual({ isbn13: null, goodreadsId: null, query: 'Klara und die Sonne', titleHint: 'Klara und die Sonne' })
  })

  it('uses the title when the text is only a link', () => {
    const shared = parseShared({ title: 'Some Bookshop – Piranesi', text: 'https://example.com/p/42' })
    expect(shared.query).toBe('Some Bookshop – Piranesi')
    expect(shared.isbn13).toBeNull()
  })

  it('reads a `url` that is really a title', () => {
    expect(parseShared({ url: 'Klara und die Sonne' }).query).toBe('Klara und die Sonne')
  })

  it('is empty when nothing usable was shared', () => {
    expect(parseShared({})).toEqual({ isbn13: null, goodreadsId: null, query: '', titleHint: '' })
    expect(parseShared({ title: '  ', text: 'https://example.com/' }).query).toBe('')
  })

  it('searches the ISBN itself when the share is nothing else', () => {
    expect(parseShared({ text: PIRANESI }).query).toBe(PIRANESI)
  })
})

describe('cleanSharedText and linksIn', () => {
  it('drops links, quotes and the sharing app’s words', () => {
    expect(cleanSharedText('Check out “Piranesi” by Susanna Clarke https://a.co/d/abc')).toBe('Piranesi by Susanna Clarke')
    expect(cleanSharedText('Piranesi by Susanna Clarke (Goodreads)')).toBe('Piranesi by Susanna Clarke')
    expect(cleanSharedText('Piranesi - Amazon.de')).toBe('Piranesi')
  })

  it('cuts a link before the punctuation that ends the sentence', () => {
    expect(linksIn('Look (https://example.com/a/b). And https://example.org/c!')).toEqual(['https://example.com/a/b', 'https://example.org/c'])
  })
})

describe('namesTheBook', () => {
  it('matches the same title, accents, case and a subtitle aside', () => {
    expect(namesTheBook('Piranesi', 'Piranesi')).toBe(true)
    expect(namesTheBook('piranesi', 'Piranesi: A Novel')).toBe(true)
    expect(namesTheBook('Klara und die Sonne', 'Klara und die Sönne')).toBe(true)
    expect(namesTheBook('Piranesi', 'Piranesi (Large Print)')).toBe(true)
  })

  it('does not match another book or an empty hint', () => {
    expect(namesTheBook('Piranesi', 'The Piranesi Prints')).toBe(false)
    expect(namesTheBook('', 'Piranesi')).toBe(false)
  })
})

describe('the share kept through the sign-in', () => {
  function storage(): DeviceStorage {
    const items = new Map<string, string>()
    return {
      get length() {
        return items.size
      },
      key: (i) => [...items.keys()][i] ?? null,
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
      removeItem: (key) => void items.delete(key),
    }
  }

  it('is kept, read back and forgotten once taken', () => {
    const device = storage()
    expect(peekShare(device)).toBeNull()
    keepShare(device, { url: 'https://www.amazon.com/dp/163557563X' }, 1000)
    expect(peekShare(device, 2000)).toEqual({ url: 'https://www.amazon.com/dp/163557563X' })
    expect(takeShare(device, 2000)).toEqual({ url: 'https://www.amazon.com/dp/163557563X' })
    expect(peekShare(device, 2000)).toBeNull()
  })

  it('is dropped after an hour and when unreadable', () => {
    const device = storage()
    keepShare(device, { text: 'Piranesi' }, 0)
    expect(peekShare(device, PENDING_SHARE_TTL_MS + 1)).toBeNull()
    device.setItem(PENDING_SHARE_KEY, '{nope')
    expect(peekShare(device)).toBeNull()
    expect(device.getItem(PENDING_SHARE_KEY)).toBeNull()
  })
})

describe('mostRecentlyUpdated', () => {
  const entry = (id: string, status: LibraryEntry['status'], progressUpdatedAt: string | null, createdAt: string): LibraryEntry =>
    ({
      id,
      status,
      addedAt: '2026-01-01T00:00:00Z',
      latestSession: { progressUpdatedAt, createdAt },
    }) as unknown as LibraryEntry

  it('picks the Currently reading entry updated last', () => {
    const entries = [
      entry('a', 'reading', '2026-10-01T10:00:00Z', '2026-09-01T00:00:00Z'),
      entry('b', 'reading', '2026-10-03T10:00:00+00:00', '2026-09-01T00:00:00Z'),
      entry('c', 'finished', '2026-10-09T10:00:00Z', '2026-09-01T00:00:00Z'),
    ]
    expect(mostRecentlyUpdated(entries)?.id).toBe('b')
  })

  it('counts a read never updated from the day it started', () => {
    const entries = [
      entry('a', 'reading', '2026-10-01T10:00:00Z', '2026-09-01T00:00:00Z'),
      entry('b', 'reading', null, '2026-10-02T00:00:00Z'),
    ]
    expect(mostRecentlyUpdated(entries)?.id).toBe('b')
  })

  it('is null when nothing is being read', () => {
    expect(mostRecentlyUpdated([entry('c', 'finished', null, '2026-09-01T00:00:00Z')])).toBeNull()
    expect(mostRecentlyUpdated([])).toBeNull()
  })
})
