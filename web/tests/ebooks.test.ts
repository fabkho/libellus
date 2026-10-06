import { describe, expect, it } from 'vitest'
import type { Book } from '@/data/books'
import { createEbooks, memoryEbookRecords, reportOf, type EbookRecord } from '@/data/ebooks/ebooks'
import { EpubError, decodeXml, displayName, isbnOfIdentifier, readEpub, readPackage } from '@/data/ebooks/epub'
import { EPUB_READER_VERSION, memberDir, memoryFiles } from '@/data/ebooks/files'
import { ingestEbook } from '@/data/ebooks/ingest'
import { cleanTitle, clearlyAnotherBook, fileAuthors, fileTitle, findQuery, mainTitle, matchEbook, sameAuthor, sameTitle } from '@/data/ebooks/match'
import type { LibraryEntry } from '@/data/library'
import {
  ANNA_KARENINA_STANDARD,
  DRACULA_GUTENBERG3,
  MOBY_DICK_GUTENBERG,
  TINY_JPEG,
  buildEpub,
  packageDocument,
  prideAndPrejudiceWithIsbn,
  withCheckDigit,
} from './support/epub'

/**
 * Ebook files linked to Books (issue #131, phase 1): what an EPUB says about
 * itself, how it is matched to a Book in the Library, and how the device keeps
 * one copy per file. Pure: fixtures built in memory (tests/support/epub.ts),
 * the copies in memory instead of the origin private file system.
 */

const ISBN = withCheckDigit('979000013101')
const ISBN_10 = '0141439513' // a valid ISBN-10 shape, for the conversion only

let ids = 0
function entry(book: Partial<Book> & { title: string; authors: string[] }): LibraryEntry {
  const id = `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`
  return {
    id: `entry-${id}`,
    status: 'want_to_read',
    addedAt: '2026-10-01T00:00:00Z',
    pageCountOverride: null,
    latestSession: null,
    book: {
      id,
      createdAt: '2026-10-01T00:00:00Z',
      isbn13: null,
      isbn10: null,
      pageCount: 300,
      year: null,
      language: 'en',
      publisher: null,
      description: null,
      coverUrl: null,
      coverThumbhash: null,
      coverColors: null,
      source: 'apple',
      appleId: null,
      openLibraryEditionKey: null,
      openLibraryWorkKey: null,
      ...book,
    },
  }
}

const file = (bytes: Uint8Array, name = 'book.epub') => new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/epub+zip' })

describe('reading an EPUB', () => {
  it('reads an EPUB 2 package document: title, author, language, publisher, the cover named by <meta name="cover">', () => {
    const read = readEpub(buildEpub(MOBY_DICK_GUTENBERG))
    expect(read).toMatchObject({
      title: 'Moby Dick; Or, The Whale',
      authors: ['Herman Melville'],
      language: 'en',
      publisher: 'Project Gutenberg',
      isbns: [],
      identifiers: ['http://www.gutenberg.org/2701'],
      coverPath: 'OEBPS/images/cover.jpg',
      coverType: 'image/jpeg',
    })
    expect(read.cover).toEqual(TINY_JPEG)
  })

  it('reads an EPUB 3 package document: the main title, the author without the translator, the cover-image item', () => {
    const read = readEpub(buildEpub(ANNA_KARENINA_STANDARD))
    expect(read.title).toBe('Anna Karenina')
    expect(read.authors).toEqual(['Leo Tolstoy'])
    expect(read.publisher).toBe('Standard Ebooks')
    expect(read.coverPath).toBe('OEBPS/images/cover.jpg')
    expect(read.cover).toEqual(TINY_JPEG)
  })

  it('names an author by the sort name turned round when the file has one ("graf Leo Tolstoy" filed as "Tolstoy, Leo, graf")', () => {
    const read = readEpub(buildEpub({ version: 3, title: 'Anna Karenina', creators: [{ name: 'graf Leo Tolstoy', role: 'aut', fileAs: 'Tolstoy, Leo, graf' }] }))
    expect(read.authors).toEqual(['Leo Tolstoy'])
    const v2 = readEpub(buildEpub({ version: 2, title: 'Frankenstein', creators: [{ name: 'Mary W. Shelley', role: 'aut', fileAs: 'Shelley, Mary Wollstonecraft' }] }))
    expect(v2.authors).toEqual(['Mary Wollstonecraft Shelley'])
  })

  it('finds the package document wherever the container says, and turns "Stoker, Bram" round', () => {
    const read = readEpub(buildEpub(DRACULA_GUTENBERG3))
    expect(read.title).toBe('Dracula')
    expect(read.authors).toEqual(['Bram Stoker'])
    expect(read.coverPath).toBe('345/images/cover.jpg')
  })

  it('leaves the cover out when not asked for, and copes with a file without one', () => {
    expect(readEpub(buildEpub(MOBY_DICK_GUTENBERG), { cover: false }).cover).toBeNull()
    const read = readEpub(buildEpub(prideAndPrejudiceWithIsbn(ISBN)))
    expect(read.coverPath).toBeNull()
    expect(read.cover).toBeNull()
    expect(read.isbns).toEqual([ISBN])
  })

  it('refuses what is not an EPUB', () => {
    expect(() => readEpub(new TextEncoder().encode('not a zip at all'))).toThrow(EpubError)
  })

  it('decodes entities and ignores comments in the package document', () => {
    const opf = packageDocument({ version: 2, title: 'Pride & Prejudice', creators: [{ name: 'Jane Austen' }] }).replace(
      '<dc:language>',
      '<!-- <dc:title>Not this</dc:title> --><dc:language>',
    )
    const read = readPackage(opf, 'content.opf')
    expect(read.title).toBe('Pride & Prejudice')
    expect(read.authors).toEqual(['Jane Austen'])
  })
})

describe('ISBNs in identifiers', () => {
  it.each([
    [`urn:isbn:${ISBN}`, false, ISBN],
    [`isbn:${ISBN.slice(0, 3)}-${ISBN.slice(3, 4)}-${ISBN.slice(4, 8)}-${ISBN.slice(8, 12)}-${ISBN.slice(12)}`, false, ISBN],
    [ISBN, false, ISBN],
    [`urn:isbn:${ISBN_10}`, false, '9780141439518'],
    [ISBN_10, true, '9780141439518'],
  ])('%s (labelled ISBN: %s) is %s', (value, labelled, isbn) => {
    expect(isbnOfIdentifier(value, labelled)).toBe(isbn)
  })

  it.each([
    ['http://www.gutenberg.org/2701'],
    ['urn:uuid:4c6c4a4e-1c2a-4b6f-9f61-2b8d3c6f2f39'],
    [ISBN_10], // a bare ten digits, not labelled: could be any number
    ['9790000131018'], // a wrong check digit
  ])('%s is no ISBN', (value) => {
    expect(isbnOfIdentifier(value)).toBeNull()
  })

  it('reads EPUB 2 opf:scheme="ISBN" and EPUB 3 identifier-type 15, without duplicates', () => {
    const v2 = readPackage(
      packageDocument({ version: 2, title: 'X', creators: [], identifiers: [{ value: ISBN_10, scheme: 'ISBN' }, { value: 'urn:isbn:9780141439518' }] }),
      'content.opf',
    )
    expect(v2.isbns).toEqual(['9780141439518'])
    const v3 = readPackage(packageDocument({ version: 3, title: 'X', creators: [], identifiers: [{ value: ISBN, type: '15' }] }), 'content.opf')
    expect(v3.isbns).toEqual([ISBN])
  })

  it('turns "Last, First" names round, leaving suffixes and plain names alone', () => {
    expect(displayName('Tolstoy, Leo, graf')).toBe('Leo Tolstoy')
    expect(displayName('Melville, Herman')).toBe('Herman Melville')
    expect(displayName('Martin Luther King, Jr.')).toBe('Martin Luther King, Jr.')
    expect(displayName('Herman Melville')).toBe('Herman Melville')
  })
})

describe('matching a file to a Book', () => {
  const moby = entry({ title: 'Moby-Dick', authors: ['Herman Melville'] })
  const anna = entry({ title: 'Anna Karenina', authors: ['Lev Tolstoy'] })
  const pride = entry({ title: 'Pride and Prejudice (Penguin Classics)', authors: ['Jane Austen'], isbn13: ISBN })
  const library = [moby, anna, pride]

  it('links by ISBN first, whatever the title says', () => {
    expect(matchEbook({ title: 'Something else', authors: [], isbns: [ISBN] }, library)).toEqual({ kind: 'linked', entry: pride, by: 'isbn' })
  })

  it("links by an ISBN-10 the Book is known by", () => {
    const old = entry({ title: 'Old', authors: ['A'], isbn10: ISBN_10 })
    expect(matchEbook({ title: null, authors: [], isbns: ['9780141439518'] }, [old])).toMatchObject({ kind: 'linked', entry: old })
  })

  it('links by title without its subtitle and the first author, surname or initials aside', () => {
    expect(matchEbook(readEpub(buildEpub(MOBY_DICK_GUTENBERG)), library)).toEqual({ kind: 'linked', entry: moby, by: 'title' })
    expect(matchEbook(readEpub(buildEpub(ANNA_KARENINA_STANDARD)), library)).toEqual({ kind: 'linked', entry: anna, by: 'title' })
    expect(matchEbook({ title: 'Pride and Prejudice', authors: ['Jane Austen'], isbns: [] }, library)).toMatchObject({
      kind: 'linked',
      entry: pride,
    })
  })

  it('asks when two Books fit, or a title fits without its author', () => {
    const otherMoby = entry({ title: 'Moby Dick', authors: ['Herman Melville'], isbn13: withCheckDigit('979000013102') })
    expect(matchEbook(readEpub(buildEpub(MOBY_DICK_GUTENBERG)), [...library, otherMoby])).toEqual({ kind: 'ambiguous', candidates: [moby, otherMoby] })
    expect(matchEbook({ title: 'Anna Karenina', authors: ['Someone Else'], isbns: [] }, library)).toEqual({ kind: 'ambiguous', candidates: [anna] })
  })

  it('finds nothing for a Book that is not in the Library', () => {
    expect(matchEbook(readEpub(buildEpub(DRACULA_GUTENBERG3)), library)).toEqual({ kind: 'none' })
    expect(matchEbook({ title: null, authors: [], isbns: [] }, library)).toEqual({ kind: 'none' })
  })

  it('reads titles and names the way matching does', () => {
    expect(sameTitle('Moby Dick; Or, The Whale', 'Moby-Dick')).toBe(true)
    expect(sameTitle('War and Peace', 'War & Peace')).toBe(true)
    expect(sameTitle('Dracula', "Dracula's Guest")).toBe(false)
    // A title that begins with an abbreviation is not cut there.
    expect(sameTitle('Dr. Jekyll and Mr. Hyde', 'Dr. No')).toBe(false)
    expect(clearlyAnotherBook({ title: 'Dr. No', authors: [], isbns: [] }, { title: 'Dr. Jekyll and Mr. Hyde', authors: [], isbn13: null, isbn10: null })).toBe(true)
    expect(sameAuthor('J. R. R. Tolkien', 'Tolkien')).toBe(true)
    expect(sameAuthor('Leo Tolstoy', 'Lev Tolstoy')).toBe(true)
    expect(sameAuthor('Jane Austen', 'Jane Eyre')).toBe(false)
  })

  it('says when a file picked for a Book is clearly another book', () => {
    const anna = { title: 'Anna Karenina', authors: ['Leo Tolstoy'], isbn13: null, isbn10: null }
    expect(clearlyAnotherBook({ title: 'Anna Karenina', authors: ['Leo Tolstoy'], isbns: [] }, anna)).toBe(false)
    expect(clearlyAnotherBook({ title: 'War and Peace', authors: ['Leo Tolstoy'], isbns: [] }, anna)).toBe(true)
    expect(clearlyAnotherBook({ title: null, authors: [], isbns: [] }, anna)).toBe(false)
    expect(clearlyAnotherBook({ title: 'Anything', authors: [], isbns: [ISBN] }, { ...anna, isbn13: ISBN })).toBe(false)
    expect(clearlyAnotherBook({ title: 'Anna', authors: [], isbns: [ISBN] }, { ...anna, isbn13: withCheckDigit('979000013102') })).toBe(true)
  })

  it('searches for the title without subtitle and the first author, or the file name', () => {
    expect(findQuery({ title: 'Moby Dick; Or, The Whale', authors: ['Herman Melville'] }, 'x.epub')).toBe('Moby Dick Herman Melville')
    expect(findQuery({ title: null, authors: [] }, 'the_time-machine.epub')).toBe('the time machine')
  })
})

describe('titles and text as files write them', () => {
  it('cleans a title of what file names and download sites leave on it', () => {
    expect(cleanTitle('Harry Potter und der Halbblutprinz (2005)(1)')).toBe('Harry Potter und der Halbblutprinz')
    expect(cleanTitle('The Forever War (The Forever War, #1)')).toBe('The Forever War')
    expect(cleanTitle('Disquiet Gods (Sun Eater Book 6)')).toBe('Disquiet Gods')
    expect(cleanTitle('Shadow & Claw [Retail] (z-lib.org)')).toBe('Shadow & Claw')
    expect(cleanTitle('The_Name_of_the_Wind.epub')).toBe('The Name of the Wind')
    expect(cleanTitle('Haldeman, Joe - The Forever War', ['Joe Haldeman'])).toBe('The Forever War')
    // What is part of the title stays.
    expect(cleanTitle('1984')).toBe('1984')
    expect(cleanTitle('Catch-22')).toBe('Catch-22')
    expect(cleanTitle('Men at Arms')).toBe('Men at Arms')
    expect(cleanTitle('Hyperion - The Fall', ['Dan Simmons'])).toBe('Hyperion - The Fall')
    expect(cleanTitle('(1)')).toBe('(1)')
  })

  it('composes letters (NFC) and drops invisible characters, for showing and for matching', () => {
    const decomposed = 'Harry Potter und die Heiligtu\u0308mer des Todes'
    expect(cleanTitle(decomposed)).toBe('Harry Potter und die Heiligtümer des Todes')
    expect(cleanTitle(decomposed)).toHaveLength(42)
    expect(fileTitle({ title: 'Dis\u00ADquiet Gods', authors: [] })).toBe('Disquiet Gods')
    expect(fileAuthors({ authors: ['Christopher\u200B Ruocchio', 'Jo\u0308rg Fauser'] })).toEqual(['Christopher Ruocchio', 'Jörg Fauser'])
  })

  it('matches a file whose title has a soft hyphen, a series in brackets or a year, as the Book it is', () => {
    const gods = entry({ title: 'Disquiet Gods : The Sun Eater', authors: ['Christopher Ruocchio'] })
    const war = entry({ title: 'The Forever War', authors: ['Joe Haldeman', 'John Scalzi'] })
    const prinz = entry({ title: 'Harry Potter und der Halbblutprinz', authors: ['J.K. Rowling'] })
    const library = [gods, war, prinz]
    const match = (title: string, authors: string[]) => matchEbook({ title, authors, isbns: [] }, library)
    expect(match('Dis\u00ADquiet Gods', ['Christopher Ruocchio'])).toMatchObject({ kind: 'linked', entry: gods })
    expect(match('[Sun Eater 06] Disquiet Gods', ['Christopher Ruocchio'])).toMatchObject({ kind: 'linked', entry: gods })
    expect(match('The For\u200Bever War', ['Joe Haldeman'])).toMatchObject({ kind: 'linked', entry: war })
    expect(match('Harry Potter und der Halbblutprinz (2005)(1)', ['Joanne K. Rowling'])).toMatchObject({ kind: 'linked', entry: prinz })
    expect(mainTitle('[Sun Eater 06] Disquiet Gods')).toBe('Disquiet Gods')
    expect(sameTitle('Dis quiet Gods', 'Disquiet Gods')).toBe(true)
    expect(findQuery({ title: 'Dis\u00ADquiet Gods (Sun Eater Book 6)', authors: ['Christopher Ruocchio'] }, 'x.epub')).toBe('Disquiet Gods Christopher Ruocchio')
  })

  it('decodes the package document by its byte order mark or declared encoding, strictly as UTF-8 otherwise', () => {
    const opf = (title: string, declaration = '<?xml version="1.0" encoding="utf-8"?>') =>
      `${declaration}<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata></package>`
    const title = (text: string) => readPackage(text, 'content.opf').title
    // Declared Latin-1: "ü" is one byte.
    const latin1 = Uint8Array.from(opf('Heiligtümer', '<?xml version="1.0" encoding="ISO-8859-1"?>'), (char) => char.charCodeAt(0))
    expect(title(decodeXml(latin1))).toBe('Heiligtümer')
    // UTF-16 with its mark.
    const utf16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(Uint16Array.from(opf('Heiligtümer', '<?xml version="1.0" encoding="UTF-16"?>'), (char) => char.charCodeAt(0)).buffer)])
    expect(title(decodeXml(utf16))).toBe('Heiligtümer')
    // UTF-8 with a decomposed "ü": composed.
    expect(title(decodeXml(new TextEncoder().encode(opf('Heiligtu\u0308mer'))))).toBe('Heiligtümer')
    // Undeclared bytes that are not UTF-8 are Windows-1252, not replacement characters.
    const undeclared = Uint8Array.from(opf('Heiligtümer', '<?xml version="1.0"?>'), (char) => char.charCodeAt(0))
    expect(title(decodeXml(undeclared))).toBe('Heiligtümer')
    // A decomposed letter spelled as an entity is composed too.
    expect(readPackage(opf('Heiligtu&#x308;mer'), 'content.opf').title).toBe('Heiligtümer')
  })
})

describe('the files on the device', () => {
  const MEMBER = 'member-1'
  function setup(entries: LibraryEntry[] = []) {
    const files = memoryFiles()
    const records = memoryEbookRecords()
    const ingested: string[] = []
    const ebooks = createEbooks({
      memberId: MEMBER,
      records,
      files,
      ingest: (blob) => {
        ingested.push((blob as File).name)
        return ingestEbook(blob, { dir: memberDir(MEMBER), files })
      },
      now: () => new Date('2026-10-07T10:00:00Z'),
    })
    return { files, records, ebooks, entries, ingested }
  }

  it('copies a file once, under its fingerprint, with its cover, and links it', async () => {
    const moby = entry({ title: 'Moby-Dick', authors: ['Herman Melville'] })
    const { files, ebooks } = setup()
    const bytes = buildEpub(MOBY_DICK_GUTENBERG)
    const added = await ebooks.add(file(bytes, 'pg2701.epub'), { source: 'share', name: 'pg2701.epub', lastModified: 123 }, [moby])
    expect(added.ok).toBe(true)
    const record = (added as { record: EbookRecord }).record
    expect(record).toMatchObject({ state: 'linked', bookId: moby.book.id, entryId: moby.id, source: 'share', name: 'pg2701.epub', lastModified: null })
    expect(record.path).toMatch(new RegExp(`^ebooks/${MEMBER}/[0-9a-f]{32}-${bytes.length}\\.epub$`))
    expect(files.saved.get(record.path)).toEqual(bytes)
    expect(files.saved.get(record.coverPath!)).toEqual(TINY_JPEG)
  })

  it('knows the same file shared again, picked or found under another name: one record, one copy', async () => {
    const { files, ebooks } = setup()
    const bytes = buildEpub(DRACULA_GUTENBERG3)
    const first = await ebooks.add(file(bytes), { source: 'share', name: 'dracula.epub', lastModified: null }, [])
    const again = await ebooks.add(file(bytes), { source: 'folder', name: 'Dracula (1897).epub', lastModified: 99, folderPath: 'Horror/Dracula (1897).epub' }, [])
    expect(first).toMatchObject({ ok: true, duplicate: false, record: { state: 'unlinked' } })
    expect(again).toMatchObject({ ok: true, duplicate: true, record: { folderPath: 'Horror/Dracula (1897).epub', lastModified: 99 } })
    expect(await ebooks.list()).toHaveLength(1)
    expect([...files.saved.keys()].filter((key) => key.endsWith('.epub'))).toHaveLength(1)
    // Another edition of the same book is another file.
    await ebooks.add(file(buildEpub({ ...DRACULA_GUTENBERG3, body: 'A second edition.' })), { source: 'share', name: 'dracula2.epub', lastModified: null }, [])
    expect(await ebooks.list()).toHaveLength(2)
  })

  it('reports a share in its words: total, linked, waiting, not an EPUB', async () => {
    const moby = entry({ title: 'Moby-Dick', authors: ['Herman Melville'] })
    const { ebooks } = setup()
    const results = [
      await ebooks.add(file(buildEpub(MOBY_DICK_GUTENBERG)), { source: 'share', name: 'a.epub', lastModified: null }, [moby]),
      await ebooks.add(file(buildEpub(DRACULA_GUTENBERG3)), { source: 'share', name: 'b.epub', lastModified: null }, [moby]),
      await ebooks.add(file(new TextEncoder().encode('nope')), { source: 'share', name: 'c.epub', lastModified: null }, [moby]),
      await ebooks.add(file(buildEpub(MOBY_DICK_GUTENBERG)), { source: 'share', name: 'a copy.epub', lastModified: null }, [moby]),
    ]
    expect(results[2]).toEqual({ ok: false, name: 'c.epub', error: 'not_epub' })
    const report = reportOf(results)
    expect(report).toMatchObject({ total: 3, linked: 1, needsYou: 1, failed: 1, ignored: 0 })
    expect(report.ids).toHaveLength(2)
  })

  it('never takes a Book from the file linked to it: a second match waits for the member, who may replace it', async () => {
    const moby = entry({ title: 'Moby-Dick', authors: ['Herman Melville'] })
    const { files, ebooks } = setup()
    const first = (await ebooks.add(file(buildEpub(MOBY_DICK_GUTENBERG)), { source: 'share', name: 'a.epub', lastModified: null }, [moby])) as { record: EbookRecord }
    const second = (await ebooks.add(file(buildEpub({ ...MOBY_DICK_GUTENBERG, body: 'other' })), { source: 'share', name: 'b.epub', lastModified: null }, [moby])) as {
      record: EbookRecord
    }
    expect(second.record).toMatchObject({ state: 'unlinked', candidates: [moby.book.id] })
    await ebooks.link(second.record, moby)
    const after = await ebooks.list()
    // The replaced file's copy goes; its record stays, ignored as replaced, so a rescan never offers it again.
    expect(after.map((r) => [r.id, r.state, r.ignoredAs ?? null]).sort()).toEqual(
      [
        [first.record.id, 'ignored', 'replaced'],
        [second.record.id, 'linked', null],
      ].sort(),
    )
    expect(files.saved.has(first.record.path)).toBe(false)
    // Shared again, the replaced file is counted and left alone.
    const again = await ebooks.add(file(buildEpub(MOBY_DICK_GUTENBERG)), { source: 'share', name: 'a copy.epub', lastModified: null }, [moby])
    expect(again).toMatchObject({ ok: true, duplicate: true, record: { state: 'ignored' } })
    expect(files.saved.has(first.record.path)).toBe(false)
  })

  it('unlinks (the copy goes, the Book stays), ignores (the copy goes, the file is not offered again) and links waiting files once their Book is there', async () => {
    const dracula = entry({ title: 'Dracula', authors: ['Bram Stoker'] })
    const { files, ebooks } = setup()
    const waiting = (await ebooks.add(file(buildEpub(DRACULA_GUTENBERG3)), { source: 'folder', name: 'd.epub', lastModified: 1, folderPath: 'd.epub' }, [])) as {
      record: EbookRecord
    }
    expect(waiting.record.state).toBe('unlinked')
    const [linked] = await ebooks.rematch([dracula])
    expect(linked).toMatchObject({ id: waiting.record.id, state: 'linked', bookId: dracula.book.id })

    await ebooks.unlink(linked!)
    expect(await ebooks.list()).toEqual([])
    expect(files.saved.has(linked!.path)).toBe(false)

    const again = (await ebooks.add(file(buildEpub(ANNA_KARENINA_STANDARD)), { source: 'share', name: 'a.epub', lastModified: null }, [])) as { record: EbookRecord }
    const ignored = await ebooks.ignore(again.record)
    expect(ignored.state).toBe('ignored')
    expect(files.saved.has(again.record.path)).toBe(false)
    const shared = await ebooks.add(file(buildEpub(ANNA_KARENINA_STANDARD)), { source: 'share', name: 'a.epub', lastModified: null }, [])
    expect(shared).toMatchObject({ ok: true, duplicate: true, record: { state: 'ignored' } })
    expect(files.saved.has(again.record.path)).toBe(false)
  })

  it('notices a copy the browser evicted, and writes it again when the same file comes back', async () => {
    const moby = entry({ title: 'Moby-Dick', authors: ['Herman Melville'] })
    const { files, ebooks } = setup()
    const bytes = buildEpub(MOBY_DICK_GUTENBERG)
    const { record } = (await ebooks.add(file(bytes), { source: 'share', name: 'm.epub', lastModified: null }, [moby])) as { record: EbookRecord }
    files.saved.delete(record.path)
    expect(await ebooks.missing(await ebooks.list())).toEqual(new Set([record.id]))
    await ebooks.add(file(bytes), { source: 'share', name: 'm.epub', lastModified: null }, [moby])
    expect(await ebooks.missing(await ebooks.list())).toEqual(new Set())
    expect((await ebooks.list())[0]).toMatchObject({ state: 'linked', bookId: moby.book.id })
  })

  it('follows its entry to another edition', async () => {
    const moby = entry({ title: 'Moby-Dick', authors: ['Herman Melville'] })
    const { ebooks } = setup()
    await ebooks.add(file(buildEpub(MOBY_DICK_GUTENBERG)), { source: 'share', name: 'm.epub', lastModified: null }, [moby])
    const moved = await ebooks.followEdition({ ...moby, book: { ...moby.book, id: 'another-edition' } })
    expect(moved).toHaveLength(1)
    expect((await ebooks.list())[0]).toMatchObject({ bookId: 'another-edition', entryId: moby.id })
  })

  it('scans a folder: new files taken in, known ones skipped without reading them, moved and replaced ones recognised', async () => {
    const moby = entry({ title: 'Moby-Dick', authors: ['Herman Melville'] })
    const anna = entry({ title: 'Anna Karenina', authors: ['Leo Tolstoy'] })
    const { ebooks, ingested } = setup()
    const folder = fakeFolder({
      'Moby Dick.epub': buildEpub(MOBY_DICK_GUTENBERG),
      'Russian/Anna Karenina.epub': buildEpub(ANNA_KARENINA_STANDARD),
      'Horror/Dracula.epub': buildEpub(DRACULA_GUTENBERG3),
      'notes.txt': new TextEncoder().encode('not a book'),
    })
    const first = await ebooks.scan(folder.handle, [moby, anna])
    expect(first.report).toMatchObject({ total: 3, linked: 2, needsYou: 1, failed: 0 })
    expect(ingested).toEqual(expect.arrayContaining(['Moby Dick.epub', 'Anna Karenina.epub', 'Dracula.epub']))

    ingested.length = 0
    const second = await ebooks.scan(folder.handle, [moby, anna])
    expect(second.report).toMatchObject({ total: 3, linked: 2, needsYou: 1 })
    expect(ingested).toEqual([])

    folder.move('Horror/Dracula.epub', 'Dracula.epub')
    const third = await ebooks.scan(folder.handle, [moby, anna])
    expect(third.report.total).toBe(3)
    expect((await ebooks.list()).find((r) => r.metadata.title === 'Dracula')?.folderPath).toBe('Dracula.epub')
    expect(await ebooks.list()).toHaveLength(3)
    expect(ingested).toEqual([])

    // Another file saved over the same name is read again.
    folder.replace('Dracula.epub', buildEpub({ ...DRACULA_GUTENBERG3, body: 'A corrected edition.' }))
    await ebooks.scan(folder.handle, [moby, anna])
    expect(ingested).toEqual(['Dracula.epub'])
    expect(await ebooks.list()).toHaveLength(4)
  })

  it('keeps what she decided over every rescan: a chosen Book, an Ignore, a replaced copy, a renamed or moved file', async () => {
    const hyperion = entry({ title: 'Hyperion', authors: ['Dan Simmons'] })
    const hyperionAgain = entry({ title: 'Hyperion', authors: ['Dan Simmons'], year: 1990 })
    const moby = entry({ title: 'Moby-Dick', authors: ['Herman Melville'] })
    const library = [hyperion, hyperionAgain, moby]
    const { ebooks, records } = setup()
    const HYPERION = { version: 3 as const, title: 'Hyperion', creators: [{ name: 'Dan Simmons' }] }
    const folder = fakeFolder({
      'Hyperion.epub': buildEpub(HYPERION),
      'Moby Dick.epub': buildEpub(MOBY_DICK_GUTENBERG),
      'Moby Dick (1).epub': buildEpub({ ...MOBY_DICK_GUTENBERG, body: 'another copy' }),
      'Dracula.epub': buildEpub(DRACULA_GUTENBERG3),
    })
    const first = await ebooks.scan(folder.handle, library)
    expect(first.report).toMatchObject({ total: 4, linked: 1, needsYou: 3 })
    const list = await ebooks.list()
    const byName = (name: string) => list.find((r) => r.name === name)!
    // Choose book between two editions; Ignore; the second Moby Dick replaces the first.
    await ebooks.link(byName('Hyperion.epub'), hyperionAgain)
    await ebooks.ignore(byName('Dracula.epub'))
    expect(byName('Moby Dick (1).epub')).toMatchObject({ state: 'unlinked', candidates: [moby.book.id] })
    await ebooks.link(byName('Moby Dick (1).epub'), moby)

    const states = async () => Object.fromEntries((await ebooks.list()).map((r) => [r.name, r.state]))
    const decided = { 'Hyperion.epub': 'linked', 'Dracula.epub': 'ignored', 'Moby Dick.epub': 'ignored', 'Moby Dick (1).epub': 'linked' }
    expect(await states()).toEqual(decided)

    const again = await ebooks.scan(folder.handle, library)
    expect(again.report).toMatchObject({ total: 4, linked: 2, needsYou: 0, ignored: 2 })
    expect(await states()).toEqual(decided)
    expect((await ebooks.list()).find((r) => r.name === 'Hyperion.epub')).toMatchObject({ bookId: hyperionAgain.book.id })

    // Renamed and moved, the same bytes: the same files, the same decisions.
    folder.move('Hyperion.epub', 'Simmons/Hyperion (Cantos 1).epub')
    folder.move('Dracula.epub', 'Old/dracula-copy.epub')
    const moved = await ebooks.scan(folder.handle, library)
    expect(moved.report).toMatchObject({ total: 4, linked: 2, needsYou: 0, ignored: 2 })
    expect(await ebooks.list()).toHaveLength(4)

    // A record read before the reading was fixed is read again from its copy and matched again; its link stays.
    const old = (await ebooks.list()).find((r) => r.name === 'Hyperion.epub')!
    await records.put({ ...old, reader: undefined, metadata: { ...old.metadata, title: 'Hyperion (2011)(1)' } })
    await ebooks.scan(folder.handle, library)
    expect((await ebooks.list()).find((r) => r.name === 'Hyperion.epub')).toMatchObject({ state: 'linked', bookId: hyperionAgain.book.id, reader: EPUB_READER_VERSION, metadata: { title: 'Hyperion' } })

    // Her entry left the Library: the file waits again, and fits the other edition now.
    const without = library.filter((e) => e !== hyperionAgain)
    await ebooks.scan(folder.handle, without)
    expect((await ebooks.list()).find((r) => r.name === 'Hyperion.epub')).toMatchObject({ state: 'linked', bookId: hyperion.book.id })
  })

  it('matches a waiting file again on the next scan, so a fix to matching reaches it', async () => {
    const gods = entry({ title: 'Disquiet Gods : The Sun Eater', authors: ['Christopher Ruocchio'] })
    const { ebooks, records } = setup()
    const folder = fakeFolder({ 'Disquiet Gods.epub': buildEpub({ version: 3, title: 'Disquiet Gods', creators: [{ name: 'Christopher Ruocchio' }] }) })
    await ebooks.scan(folder.handle, [])
    const waiting = (await ebooks.list())[0]!
    expect(waiting.state).toBe('unlinked')
    // As an older matcher left it: waiting, without candidates.
    await records.put({ ...waiting, candidates: [] })
    await ebooks.scan(folder.handle, [gods])
    expect((await ebooks.list())[0]).toMatchObject({ state: 'linked', bookId: gods.book.id })
  })
})

/** A folder handle stand-in: the File System Access calls a scan makes, over files in memory. Records which files were opened. */
function fakeFolder(initial: Record<string, Uint8Array>) {
  const files = new Map(Object.entries(initial).map(([path, bytes]) => [path, { bytes, lastModified: 1_700_000_000_000 + path.length }]))
  const opened: string[] = []
  function dir(prefix: string): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: prefix.split('/').filter(Boolean).pop() ?? 'Books',
      async *entries() {
        const children = new Set<string>()
        for (const path of files.keys()) {
          if (!path.startsWith(prefix)) continue
          const rest = path.slice(prefix.length)
          const name = rest.split('/')[0]!
          if (children.has(name)) continue
          children.add(name)
          if (rest.includes('/')) yield [name, dir(`${prefix}${name}/`)]
          else {
            const full = `${prefix}${name}`
            yield [
              name,
              {
                kind: 'file',
                name,
                async getFile() {
                  opened.push(full)
                  const found = files.get(full)!
                  return new File([found.bytes as Uint8Array<ArrayBuffer>], name, { lastModified: found.lastModified })
                },
              },
            ]
          }
        }
      },
    } as unknown as FileSystemDirectoryHandle
  }
  return {
    handle: dir(''),
    opened,
    move(from: string, to: string) {
      files.set(to, files.get(from)!)
      files.delete(from)
    },
    replace(path: string, bytes: Uint8Array) {
      files.set(path, { bytes, lastModified: files.get(path)!.lastModified + 60_000 })
    },
  }
}
