import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Book } from '@/data/books'
import { readMemberLibrary, type MemberLibraryEntry } from '@/data/export/memberLibrary'
import { carryArt, workKey } from '@/data/export/carryArt'
import { coverPalette, dayIn, exportRegalLibrary, regalBook } from '@/data/export/regal'
import { parseLibraryFile, validateLibraryFile } from '@/data/export/regalLibraryFile'
import { createLibrary, type ReadingSession } from '@/data/library'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The Regal export (issue #22): a Library as a Regal library file. The mapping
 * is pure and pinned against a fixture file that Regal's validator accepts
 * (the port in app/data/export/regalLibraryFile.ts; Regal's own in
 * tests/regal-library-file.test.ts when a checkout is at hand). The read is
 * checked against the local stack, through a real member's Library.
 */

const GENERATED_AT = '2026-05-01T06:00:00Z'
const fixtureText = () => readFileSync(new URL('./fixtures/regal/libellus-export.json', import.meta.url), 'utf8')

function book(n: number, fields: Partial<Book> = {}): Book {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    createdAt: '2024-01-01T10:00:00Z',
    title: `Book ${n}`,
    authors: ['Ada Example'],
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: null,
    language: 'en',
    publisher: null,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: String(1000 + n),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...fields,
  }
}

let sessionCount = 0
function session(fields: Partial<ReadingSession>): ReadingSession {
  sessionCount++
  return {
    id: `session-${sessionCount}`,
    startedOn: null,
    endedOn: null,
    outcome: 'finished',
    rating: null,
    review: null,
    abandonReason: null,
    createdAt: '2024-01-01T10:00:00Z',
    ...fields,
  }
}

/** Sessions are newest first, as `readMemberLibrary` hands them over. */
function entry(n: number, bookFields: Partial<Book>, sessions: ReadingSession[], addedAt = '2024-03-01T23:30:00Z'): MemberLibraryEntry {
  const latest = sessions[0]
  return {
    id: `entry-${n}`,
    status: !latest ? 'want_to_read' : latest.outcome ? 'finished' : 'reading',
    addedAt,
    book: book(n, bookFields),
    sessions,
  }
}

/** A Library with every case the mapping knows, in no particular order. */
function library(): MemberLibraryEntry[] {
  return [
    // Finished once: every field Libellus has.
    entry(
      3,
      {
        title: '  Kindred ',
        authors: ['Octavia E. Butler', ' '],
        isbn13: '9780807083697',
        isbn10: '0807083690',
        pageCount: 264,
        year: 2003,
        publisher: 'Beacon Press',
        description: 'Dana is pulled back in time.\n\nAgain and again.',
        coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/kindred/600x900bb.jpg',
        coverColors: { dominant: '#1a2b3c', secondary: '#f0e0c0' },
      },
      [session({ startedOn: '2024-02-01', endedOn: '2024-02-20', rating: 17, review: 'Relentless.' })],
    ),
    // Want to read. Added at 23:30 UTC: the next day in Berlin.
    entry(1, { title: 'Dawn', coverUrl: 'http://covers.openlibrary.org/b/id/1-L.jpg' }, []),
    // Currently reading for the first time.
    entry(2, { title: 'Parable of the Sower', pageCount: 345 }, [session({ startedOn: '2024-04-02', outcome: null })]),
    // Read twice, now reading a third time: the last finish speaks.
    entry(
      5,
      { title: 'Hyperion', coverColors: { dominant: '#f5f2eb', secondary: '#f0f0e8' } },
      [
        session({ startedOn: '2024-05-01', outcome: null }),
        session({ startedOn: '2023-01-02', endedOn: '2023-01-30', rating: 20, review: 'Better the second time.' }),
        session({ startedOn: '2019-06-01', endedOn: '2019-07-01', rating: 14 }),
      ],
    ),
    // Abandoned, never finished, with a review.
    entry(4, { title: 'Ruin', coverUrl: 'data:image/png;base64,AAAA' }, [
      session({ startedOn: '2024-01-05', endedOn: '2024-01-09', outcome: 'abandoned', review: 'Not now.', abandonReason: 'Slow' }),
    ]),
    // Finished, then abandoned on a re-read: dnf, but the finish is kept.
    entry(6, { title: 'Dune', isbn13: '9780441013593' }, [
      session({ startedOn: '2024-06-01', endedOn: '2024-06-03', outcome: 'abandoned' }),
      session({ endedOn: '2020-08-15', rating: 1 }),
    ]),
    // A finished read logged without dates or a Rating.
    entry(7, { title: 'Stoner', authors: [] }, [session({})]),
  ]
}

describe('exportRegalLibrary', () => {
  it('writes the fixture file, and Regal’s validator accepts it', () => {
    const file = exportRegalLibrary(library(), { generatedAt: GENERATED_AT, owner: ' Fabian ', timeZone: 'Europe/Berlin' })
    const text = `${JSON.stringify(file, null, 2)}\n`
    expect(text).toBe(fixtureText())
    const parsed = parseLibraryFile(text)
    expect(parsed.ok ? [] : parsed.errors).toEqual([])
  })

  it('round-trips the fixture through the validator unchanged', () => {
    const data: unknown = JSON.parse(fixtureText())
    expect(validateLibraryFile(data)).toEqual({ ok: true, library: data })
  })

  it('is the same file whatever order the entries come in', () => {
    const options = { generatedAt: GENERATED_AT, timeZone: 'Europe/Berlin' }
    const forwards = JSON.stringify(exportRegalLibrary(library(), options))
    expect(JSON.stringify(exportRegalLibrary(library().reverse(), options))).toBe(forwards)
    expect(JSON.stringify(exportRegalLibrary(library(), options))).toBe(forwards)
  })

  it('keeps only the statuses asked for, and an empty Library is a valid file', () => {
    const file = exportRegalLibrary(library(), { generatedAt: GENERATED_AT, statuses: ['read', 'dnf'] })
    expect(file.books.map((b) => [b.title, b.status])).toEqual([
      ['Kindred', 'read'],
      ['Ruin', 'dnf'],
      ['Dune', 'dnf'],
      ['Stoner', 'read'],
    ])
    const empty = exportRegalLibrary([], { generatedAt: GENERATED_AT })
    expect(empty).toEqual({ version: 2, generatedAt: GENERATED_AT, generator: 'libellus', books: [] })
    expect(validateLibraryFile(empty).ok).toBe(true)
  })
})

describe('regalBook', () => {
  it('maps the Status from the latest read', () => {
    const statuses = Object.fromEntries(library().map((e) => [e.book.title.trim(), regalBook(e).status]))
    expect(statuses).toEqual({
      Kindred: 'read',
      Dawn: 'to-read',
      'Parable of the Sower': 'currently-reading',
      Hyperion: 'currently-reading',
      Ruin: 'dnf',
      Dune: 'dnf',
      Stoner: 'read',
    })
  })

  it('takes the date read, Rating and review from the last finished read and counts every finish', () => {
    const hyperion = regalBook(library().find((e) => e.book.title === 'Hyperion')!)
    expect(hyperion).toMatchObject({ dateStarted: '2024-05-01', dateRead: '2023-01-30', rating: 5, review: 'Better the second time.', readCount: 2 })
    const dune = regalBook(library().find((e) => e.book.title === 'Dune')!)
    expect(dune).toMatchObject({ status: 'dnf', dateStarted: '2024-06-01', dateRead: '2020-08-15', rating: 0.25, readCount: 1 })
    expect(dune.review).toBeUndefined()
  })

  it('maps every quarter of a Rating onto Regal’s quarter stars', () => {
    for (let quarters = 1; quarters <= 20; quarters++) {
      const rated = regalBook(entry(9, {}, [session({ endedOn: '2024-01-01', rating: quarters })]))
      expect(rated.rating).toBe(quarters / 4)
      expect(validateLibraryFile({ version: 2, generatedAt: GENERATED_AT, books: [rated] }).ok).toBe(true)
    }
  })

  it('leaves out what is unknown instead of writing null', () => {
    const stoner = regalBook(library().find((e) => e.book.title === 'Stoner')!, { timeZone: 'UTC' })
    expect(stoner).toEqual({
      id: '00000000-0000-4000-8000-000000000007',
      title: 'Stoner',
      authors: [],
      status: 'read',
      dateAdded: '2024-03-01',
      readCount: 1,
    })
  })

  it('takes only http(s) Covers', () => {
    const ruin = regalBook(library().find((e) => e.book.title === 'Ruin')!)
    expect(ruin.assets).toBeUndefined()
  })
})

describe('dayIn', () => {
  it('is the calendar day in the zone asked for', () => {
    expect(dayIn('2024-03-01T22:30:00Z', 'UTC')).toBe('2024-03-01')
    expect(dayIn('2024-03-01T22:30:00Z', 'Europe/Berlin')).toBe('2024-03-01')
    expect(dayIn('2024-03-01T23:30:00Z', 'Europe/Berlin')).toBe('2024-03-02')
    expect(dayIn('2024-03-01T23:30:00+00:00', 'America/New_York')).toBe('2024-03-01')
    expect(dayIn('not a date', 'UTC')).toBeNull()
  })
})

describe('coverPalette', () => {
  it('writes the secondary colour where it reads on the dominant one', () => {
    expect(coverPalette({ dominant: '#1a2b3c', secondary: '#f0e0c0' })).toEqual({
      background: '#1a2b3c',
      text: '#f0e0c0',
      accent: '#f0e0c0',
    })
  })

  it('falls back to Regal’s ink or paper, and to the text as the accent, when it does not', () => {
    // Two pale colours: ink for the text, and the secondary too close to be an accent.
    expect(coverPalette({ dominant: '#f5f2eb', secondary: '#f0f0e8' })).toEqual({
      background: '#f5f2eb',
      text: '#2c2c2a',
      accent: '#2c2c2a',
    })
    // A mid red on near-black: stands out as an accent, too dark to read as text.
    expect(coverPalette({ dominant: '#101010', secondary: '#802020' })).toEqual({
      background: '#101010',
      text: '#f5f2eb',
      accent: '#802020',
    })
  })
})

describe('readMemberLibrary', () => {
  it('reads a member’s whole Library with every read, newest first, and exports a valid file', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const snapshot = (title: string) => ({
      title: runTitle(title),
      authors: ['Ursula K. Le Guin'],
      isbn13: null,
      isbn10: null,
      pageCount: 200,
      year: 1971,
      language: 'en',
      publisher: TEST_PUBLISHER,
      description: null,
      coverUrl: null,
      coverThumbhash: null,
      coverColors: null,
      source: 'apple' as const,
      appleId: uniqueAppleId(),
      openLibraryEditionKey: null,
      openLibraryWorkKey: null,
    })

    const wanted = await library.addToLibrary(snapshot('The Dispossessed'))
    const reread = await library.addToLibrary(snapshot('The Lathe of Heaven'), {
      status: 'finished',
      startedOn: '2020-01-01',
      endedOn: '2020-01-20',
      rating: 18,
      review: 'Dreams that change the world.',
    })
    expect(wanted.error ?? reread.error).toBeNull()
    expect((await library.readAgain(reread.data!.id, '2024-02-01')).error).toBeNull()

    const entries = await readMemberLibrary(member.client, member.id)
    expect(entries.map((e) => e.id).sort()).toEqual([wanted.data!.id, reread.data!.id].sort())
    const lathe = entries.find((e) => e.id === reread.data!.id)!
    expect(lathe.sessions.map((s) => [s.startedOn, s.outcome])).toEqual([
      ['2024-02-01', null],
      ['2020-01-01', 'finished'],
    ])

    const file = exportRegalLibrary(entries, { generatedAt: GENERATED_AT })
    expect(validateLibraryFile(file).ok).toBe(true)
    expect(file.books.find((b) => b.id === reread.data!.book.id)).toMatchObject({
      status: 'currently-reading',
      dateStarted: '2024-02-01',
      dateRead: '2020-01-20',
      rating: 4.5,
      review: 'Dreams that change the world.',
      readCount: 1,
      pages: 200,
    })
    expect(file.books.find((b) => b.id === wanted.data!.book.id)).toMatchObject({ status: 'to-read' })
  })
})

describe('carryArt', () => {
  const published = {
    version: 2 as const,
    generatedAt: GENERATED_AT,
    books: [
      // The same edition: found by its ISBN-13.
      {
        id: 'fable-kindred',
        title: 'Kindred',
        authors: ['Octavia E. Butler'],
        isbn13: '9780807083697',
        status: 'read',
        assets: {
          front: '9780807083697/front.webp',
          spine: '9780807083697/spine.webp',
          back: '9780807083697/back.webp',
          pile: { front: '9780807083697/front-pile.webp' },
          palette: { background: '#000000', text: '#ffffff', accent: '#ff0000' },
          spineColor: '#111111',
          source: 'ai' as const,
        },
      },
      // Another edition of the same work: found by title and surname.
      {
        id: 'fable-dune',
        title: 'DUNE: Deluxe Edition (Dune Chronicles, #1)',
        authors: ['Ada Example Jr.'],
        isbn13: '9780593099322',
        status: 'read',
        assets: { front: 'https://cdn.example.com/dune.webp', spine: 'dune/spine.webp' },
      },
      // Two published Books share a work: neither is taken by title.
      { id: 'a', title: 'Stoner', authors: ['A. Example'], status: 'read', assets: { spine: 'a/spine.webp' } },
      { id: 'b', title: 'Stoner', authors: ['B. Example'], status: 'read', assets: { spine: 'b/spine.webp' } },
      // No art: nothing to carry.
      { id: 'bare', title: 'Ruin', authors: ['Ada Example'], status: 'dnf' },
    ],
  }
  const base = 'https://books.example.com/v2/library.json'
  const exported = () => exportRegalLibrary(library(), { generatedAt: GENERATED_AT, statuses: ['read', 'dnf'] })

  it('gives a Book the whole published set, found by ISBN-13 or by its work', () => {
    const { file, carried, unmatched } = carryArt(exported(), published, (ref) => new URL(ref, base).href)
    expect(carried).toEqual([
      { id: '00000000-0000-4000-8000-000000000003', title: 'Kindred', from: 'fable-kindred', by: 'isbn13' },
      { id: '00000000-0000-4000-8000-000000000006', title: 'Dune', from: 'fable-dune', by: 'work' },
    ])
    expect(unmatched.map((book) => book.title)).toEqual(['Ruin', 'Stoner'])
    const kindred = file.books.find((book) => book.title === 'Kindred')!
    expect(kindred.assets).toEqual({
      front: 'https://books.example.com/v2/9780807083697/front.webp',
      palette: { background: '#000000', text: '#ffffff', accent: '#ff0000' },
      spine: 'https://books.example.com/v2/9780807083697/spine.webp',
      back: 'https://books.example.com/v2/9780807083697/back.webp',
      pile: { front: 'https://books.example.com/v2/9780807083697/front-pile.webp' },
      spineColor: '#111111',
      source: 'ai',
    })
    expect(file.books.find((book) => book.title === 'Dune')!.assets).toEqual({
      front: 'https://cdn.example.com/dune.webp',
      spine: 'https://books.example.com/v2/dune/spine.webp',
    })
    // Everything but the art is the export's, and the result is still a valid file.
    expect({ ...kindred, assets: undefined }).toEqual({ ...exported().books.find((b) => b.title === 'Kindred'), assets: undefined })
    expect(validateLibraryFile(file).ok).toBe(true)
  })

  it('keeps the Libellus Cover where a face cannot be resolved, and is the same on every run', () => {
    const once = carryArt(exported(), published, (ref) => (ref.startsWith('http') ? ref : null))
    expect(once.file.books.find((book) => book.title === 'Kindred')!.assets).toEqual({
      front: 'https://is1-ssl.mzstatic.com/image/thumb/kindred/600x900bb.jpg',
      palette: { background: '#000000', text: '#ffffff', accent: '#ff0000' },
      spineColor: '#111111',
      source: 'ai',
    })
    const again = carryArt(exported(), published, (ref) => (ref.startsWith('http') ? ref : null))
    expect(JSON.stringify(again.file)).toBe(JSON.stringify(once.file))
  })

  it('reads a work as its bare title and first author’s surname', () => {
    expect(workKey({ title: 'Golden Son (Red Rising Saga, #2)', authors: ['Pierce Brown'] })).toBe('golden son|brown')
    expect(workKey({ title: 'Klara and the Sun: A GMA Book Club Pick', authors: ['Kazuo Ishiguro'] })).toBe('klara and the sun|ishiguro')
    expect(workKey({ title: 'Les Misérables', authors: ['Victor Hugo'] })).toBe('les miserables|hugo')
    expect(workKey({ title: 'Anonymous', authors: [] })).toBe('anonymous|')
  })
})
