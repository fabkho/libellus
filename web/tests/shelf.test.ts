import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { booksReadIn, createShelf, readShelf } from '../app/data/shelf'
import { isShelfOwner } from '../app/utils/shelfOwner'

/**
 * Your shelf (#23): who has it, and what the app reads of the published Regal
 * library file (the count, a year's Books, the Spines' colours). The file is
 * the synthetic fixture the Playwright flow serves too; nothing here reaches
 * the real one.
 */
const FIXTURE = readFileSync(new URL('./fixtures/shelf/library.json', import.meta.url), 'utf8')
const OWNER = '5e1f0000-0000-4000-8000-000000000023'

describe('isShelfOwner', () => {
  it('is the configured owner, signed in', () => {
    expect(isShelfOwner(OWNER, OWNER)).toBe(true)
    expect(isShelfOwner(OWNER, ` ${OWNER} `)).toBe(true)
  })

  it('is nobody else', () => {
    expect(isShelfOwner('de000000-0000-4000-8000-000000000001', OWNER)).toBe(false)
    expect(isShelfOwner(null, OWNER)).toBe(false)
    expect(isShelfOwner(undefined, OWNER)).toBe(false)
  })

  it('is nobody at all when no owner is configured', () => {
    for (const unset of ['', '   ', undefined, null, 0]) {
      expect(isShelfOwner(OWNER, unset)).toBe(false)
      expect(isShelfOwner('', unset)).toBe(false)
      expect(isShelfOwner(null, unset)).toBe(false)
    }
  })
})

describe('readShelf', () => {
  it('reads every Book of the file, newest read first, Books without a read day last', () => {
    const { data, error } = readShelf(FIXTURE)
    expect(error).toBeNull()
    expect(data!.generatedAt).toBe('2026-10-04T07:00:00Z')
    expect(data!.books.map((book) => book.id)).toEqual([
      'shelf-07', // 2026-09-28
      'shelf-01', // 2025-11-20
      'shelf-03', // 2025-07-03, "A Map …" before "Salt …" on the same day
      'shelf-02',
      'shelf-04',
      'shelf-05',
      'shelf-06',
      'shelf-08', // being read: no read day
    ])
  })

  it('takes the Spine art\'s colour, else the palette\'s background, else none', () => {
    const books = readShelf(FIXTURE).data!.books
    const spine = (id: string) => books.find((book) => book.id === id)!.spine
    expect(spine('shelf-01')).toBe('#35503f')
    expect(spine('shelf-02')).toBe('#7a3b2e')
    expect(spine('shelf-05')).toBe('#8a6d3b')
    expect(spine('shelf-03')).toBeNull()
  })

  it('keeps what the shelf needs of a Book', () => {
    const book = readShelf(FIXTURE).data!.books.find((b) => b.id === 'shelf-03')!
    expect(book).toEqual({
      id: 'shelf-03',
      title: 'A Map of Quiet Rivers',
      authors: ['Hanne Ostrova', 'Jules Pell'],
      dateRead: '2025-07-03',
      spine: null,
      pages: 530,
    })
  })

  it('refuses what Regal would not show', () => {
    expect(readShelf('not json').error).toBe('invalid')
    expect(readShelf(JSON.stringify({ ...JSON.parse(FIXTURE), version: 1 })).error).toBe('invalid')
    expect(readShelf(JSON.stringify({ books: [] })).error).toBe('invalid')
    // A reading-tracker export, which the portfolio once read, is not a library file.
    expect(readShelf(JSON.stringify({ books: [{ title: 'Dune' }] })).error).toBe('invalid')
  })

  it('reads an empty Library as an empty shelf', () => {
    const { data } = readShelf(JSON.stringify({ version: 2, generatedAt: '2026-10-04T07:00:00Z', books: [] }))
    expect(data!.books).toEqual([])
  })
})

describe('booksReadIn', () => {
  const books = readShelf(FIXTURE).data!.books

  it('is the Books finished in that year, newest first', () => {
    expect(booksReadIn(books, 2025).map((book) => book.id)).toEqual(['shelf-01', 'shelf-03', 'shelf-02', 'shelf-04'])
    expect(booksReadIn(books, 2024).map((book) => book.id)).toEqual(['shelf-05', 'shelf-06'])
    expect(booksReadIn(books, 2026).map((book) => book.id)).toEqual(['shelf-07'])
  })

  it('leaves out Books without a read day, and years nothing was finished in', () => {
    expect(booksReadIn(books, 2023)).toEqual([])
    expect(booksReadIn(books, 2026).some((book) => book.id === 'shelf-08')).toBe(false)
  })

  it('matches the year by its digits, not a prefix of another year', () => {
    const odd = [{ id: 'x', title: 'X', authors: [], dateRead: '20250-01-01', spine: null, pages: null }]
    expect(booksReadIn(odd, 2025)).toEqual([])
  })
})

describe('createShelf', () => {
  const SRC = 'https://books.example/v2/library.json'
  const answer = (status: number, body = FIXTURE) => async () => new Response(body, { status })

  it('fetches the file without credentials and reads it', async () => {
    const asked: Array<[string, RequestInit | undefined]> = []
    const shelf = createShelf({
      src: SRC,
      online: () => true,
      fetch: async (input, init) => {
        asked.push([String(input), init])
        return new Response(FIXTURE)
      },
    })
    const { data, error } = await shelf.load()
    expect(error).toBeNull()
    expect(data!.books).toHaveLength(8)
    expect(asked).toEqual([[SRC, { credentials: 'omit' }]])
  })

  it('says unreachable for an answer that is not the file', async () => {
    expect((await createShelf({ src: SRC, online: () => true, fetch: answer(404) }).load()).error).toBe('unreachable')
    expect((await createShelf({ src: SRC, online: () => true, fetch: answer(500) }).load()).error).toBe('unreachable')
  })

  it('says invalid for a file Regal would not show', async () => {
    expect((await createShelf({ src: SRC, online: () => true, fetch: answer(200, '{"version":3}') }).load()).error).toBe('invalid')
  })

  it('tells a failed fetch offline from unreachable by the connection', async () => {
    const failing = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect((await createShelf({ src: SRC, online: () => true, fetch: failing }).load()).error).toBe('unreachable')
    expect((await createShelf({ src: SRC, online: () => false, fetch: failing }).load()).error).toBe('offline')
  })

  it('asks offline too: the service worker may hold the last file', async () => {
    const { data } = await createShelf({ src: SRC, online: () => false, fetch: answer(200) }).load()
    expect(data!.books).toHaveLength(8)
  })
})
