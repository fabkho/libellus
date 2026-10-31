import { strToU8, zipSync } from 'fflate'

/**
 * A synthetic Hardcover "everything" zip, built in memory (docs/plans/hardcover-zip.md, Tests). Nothing here comes from a real
 * export: every title, name, ISBN and day is invented ("Test Book 7", ISBNs with valid check digits from the music range 979-0,
 * which no book has). Nothing is committed as a binary: the tests build what they read.
 *
 * `Account` is a small typed builder over the export's own files (records as the export's README describes them); tests add
 * what they need and ask for `zip()`. The zip-level helpers (`lieAboutSize`, `manyEntries`) make the broken ones.
 */

type Rec = Record<string, unknown>

/** A valid ISBN-13 from the music range (979-0), unique per `n`. */
export function testIsbn(n: number): string {
  const body = `9790${String(n).padStart(8, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/** A cover as the export writes it (`cached_image`). */
export type CoverSpec = { url?: string; width?: number; height?: number } | null

const image = (id: number, spec: CoverSpec | undefined): Rec | null =>
  spec === null
    ? null
    : {
        id,
        url: spec?.url ?? `https://assets.hardcover.app/test/${id}.jpg`,
        width: spec?.width ?? 400,
        height: spec?.height ?? 600,
        color: '#aabbcc',
        color_name: 'Gray',
      }

/** An author: a name, or a name with a role (`['Tessa Test', 'Translator']`). */
export type CreditSpec = string | [name: string, role: string]

export type BookSpec = {
  title: string
  authors?: readonly CreditSpec[]
  pages?: number | null
  year?: number | null
  series?: { name: string; position?: number | null; featured?: boolean }[]
  cover?: CoverSpec
  audioSeconds?: number | null
  defaultEdition?: number | null
}

export type EditionSpec = {
  title?: string
  isbn13?: string | null
  isbn10?: string | null
  pages?: number | null
  format?: string | null
  readingFormat?: number | null
  language?: string | null
  publisher?: string | null
  year?: number | null
  releaseDate?: string | null
  cover?: CoverSpec
  authors?: readonly CreditSpec[]
  audioSeconds?: number | null
}

export type ReadSpec = {
  started?: string | null
  finished?: string | null
  /** 0 unknown, 1 full date, 2 month, 3 year; unset: null, as an open read. */
  precision?: number | null
  paused?: string | null
  pages?: number | null
  percent?: number | null
  seconds?: number | null
  edition?: number | null
}

export type ShelveSpec = {
  status: 1 | 2 | 3 | 4 | 5 | 6
  rating?: string | number | null
  review?: { markdown?: string | null; raw?: string | null; html?: string | null }
  owned?: boolean
  edition?: number | null
  addedOn?: string | null
  reads?: ReadSpec[]
}

export type ZipOptions = {
  /** The entries live in this folder (a member zipped the folder again). */
  folder?: string
  /** Files left out (`lists`, `contributions` …). */
  omit?: string[]
  /** The manifest as written; `null` writes none. */
  manifest?: Rec | null
  /** Entries added as they are (name → bytes). */
  extra?: Record<string, Uint8Array>
  /** Files replaced by their raw text (name → text). */
  raw?: Record<string, string>
  /** deflate level; 0 stores. */
  level?: 0 | 1 | 6 | 9
}

export class Account {
  userId = 900_001
  private counter = 1000
  private files: Record<string, Rec[]> = {}
  private authorIds = new Map<string, number>()
  private languageIds = new Map<string, number>()
  private publisherIds = new Map<string, number>()
  private seriesIds = new Map<string, number>()
  /** `cached_contributors` of a book or edition: written as such, or left empty and kept in `contributions.json`. */
  credits: 'cached' | 'contributions' = 'cached'
  /** What the manifest says besides the format and the version. */
  exportedAt = '2026-10-31T09:00:00Z'

  constructor() {
    for (const name of FILES) this.files[name] = []
  }

  private id(): number {
    return this.counter++
  }

  private push(file: string, rec: Rec): number {
    const id = this.id()
    this.files[file]!.push({ id, ...rec })
    return id
  }

  private author(name: string): number {
    let id = this.authorIds.get(name)
    if (!id) {
      id = this.push('authors', { name })
      this.authorIds.set(name, id)
    }
    return id
  }

  language(code2: string): number {
    let id = this.languageIds.get(code2)
    if (!id) {
      id = this.push('languages', { language: `Language ${code2}`, code2, code3: `${code2}x` })
      this.languageIds.set(code2, id)
    }
    return id
  }

  publisher(name: string): number {
    let id = this.publisherIds.get(name)
    if (!id) {
      id = this.push('publishers', { name, state: 'active' })
      this.publisherIds.set(name, id)
    }
    return id
  }

  private cached(credits: readonly CreditSpec[]): Rec[] {
    return credits.map((credit) => {
      const [name, role] = typeof credit === 'string' ? [credit, 'Author'] : credit
      return { author: { id: this.author(name), name, slug: name.toLowerCase().replace(/\s+/g, '-') }, contribution: role }
    })
  }

  private credit(type: 'Book' | 'Edition', target: number, credits: readonly CreditSpec[]): Rec[] {
    if (this.credits === 'cached') return this.cached(credits)
    for (const credit of credits) {
      const [name, role] = typeof credit === 'string' ? [credit, 'Author'] : credit
      this.push('contributions', { contributable_type: type, contributable_id: target, contribution: role, author_id: this.author(name) })
    }
    return []
  }

  /** A catalogue book. */
  book(spec: BookSpec): number {
    const id = this.id()
    this.files.books!.push({
      id,
      title: spec.title,
      pages: spec.pages ?? null,
      release_year: spec.year ?? null,
      release_date: null,
      cached_image: image(id, spec.cover),
      cached_contributors: this.credit('Book', id, spec.authors ?? ['Tessa Test']),
      default_physical_edition_id: spec.defaultEdition ?? null,
      audio_seconds: spec.audioSeconds ?? null,
    })
    for (const series of spec.series ?? []) {
      let seriesId = this.seriesIds.get(series.name)
      if (!seriesId) {
        seriesId = this.push('series', { name: series.name })
        this.seriesIds.set(series.name, seriesId)
      }
      this.push('book_series', { book_id: id, series_id: seriesId, position: series.position ?? null, featured: series.featured ?? true })
    }
    return id
  }

  /** An edition of a book. */
  edition(book: number, spec: EditionSpec = {}): number {
    const id = this.id()
    const works = this.files.books!.find((rec) => rec.id === book)
    this.files.editions!.push({
      id,
      book_id: book,
      title: spec.title ?? (works?.title as string),
      isbn_13: spec.isbn13 ?? null,
      isbn_10: spec.isbn10 ?? null,
      pages: spec.pages ?? null,
      edition_format: spec.format ?? null,
      reading_format_id: spec.readingFormat ?? 1,
      language_id: spec.language ? this.language(spec.language) : null,
      publisher_id: spec.publisher ? this.publisher(spec.publisher) : null,
      release_year: spec.year ?? null,
      release_date: spec.releaseDate ?? null,
      cached_image: image(id, spec.cover),
      cached_contributors: spec.authors ? this.credit('Edition', id, spec.authors) : [],
      audio_seconds: spec.audioSeconds ?? null,
    })
    return id
  }

  /** A book on one of her shelves, with its reads. */
  shelve(book: number, spec: ShelveSpec): number {
    const id = this.id()
    this.files.user_books!.push({
      id,
      user_id: this.userId,
      book_id: book,
      status_id: spec.status,
      rating: spec.rating === undefined || spec.rating === null ? null : String(spec.rating),
      review_markdown: spec.review?.markdown ?? null,
      review_raw: spec.review?.raw ?? null,
      review: spec.review?.html ?? null,
      owned: spec.owned ?? false,
      edition_id: spec.edition ?? null,
      date_added: spec.addedOn === undefined ? '2024-01-05' : spec.addedOn,
    })
    for (const read of spec.reads ?? []) {
      this.files.user_book_reads!.push({
        id: this.id(),
        user_book_id: id,
        started_at: read.started ?? null,
        finished_at: read.finished ?? null,
        paused_at: read.paused ?? null,
        edition_id: read.edition ?? null,
        progress_pages: read.pages ?? null,
        progress_seconds: read.seconds ?? 0,
        progress: read.percent ?? (read.finished ? 100 : null),
        finished_at_precision: read.precision === undefined ? (read.finished ? 1 : null) : read.precision,
      })
    }
    return id
  }

  /** One of her lists (or, with `owner`, one of someone else's she contributed to). */
  list(name: string, spec: { ranked?: boolean; owner?: number } = {}): number {
    return this.push('lists', { name, user_id: spec.owner ?? this.userId, ranked: spec.ranked ?? false })
  }

  onList(list: number, book: number, spec: { position?: number | null; edition?: number | null; addedAt?: string } = {}): number {
    return this.push('list_books', {
      list_id: list,
      book_id: book,
      position: spec.position ?? null,
      edition_id: spec.edition ?? null,
      date_added: spec.addedAt ?? '2024-02-03T10:00:00.000Z',
    })
  }

  /** The files as the export names them (without the manifest). */
  records(): Record<string, Rec[]> {
    return this.files
  }

  manifest(): Rec {
    return { format: 'hardcover-everything', version: 1, exported_at: this.exportedAt, user_id: this.userId }
  }

  /** The zip: the files the import needs, a few it never reads (one of them not even JSON), as the export lays them out flat. */
  zip(options: ZipOptions = {}): Uint8Array {
    const prefix = options.folder ? `${options.folder}/` : ''
    const entries: Record<string, Uint8Array> = {}
    const put = (name: string, value: unknown) => {
      entries[`${prefix}${name}.json`] = strToU8(JSON.stringify(value))
    }
    if (options.manifest !== null) put('manifest', options.manifest ?? this.manifest())
    for (const [name, rows] of Object.entries(this.files)) put(name, rows)
    // Never read, so never inflated: a file that is not even JSON.
    entries[`${prefix}activities.json`] = strToU8('this is not json {')
    entries[`${prefix}profile.json`] = strToU8('{"name":"Test Person"}')
    entries[`${prefix}README.md`] = strToU8('# Test export')
    for (const name of options.omit ?? []) delete entries[`${prefix}${name}.json`]
    for (const [name, text] of Object.entries(options.raw ?? {})) entries[`${prefix}${name}.json`] = strToU8(text)
    for (const [name, bytes] of Object.entries(options.extra ?? {})) entries[name] = bytes
    return zipSync(entries, { level: options.level ?? 6 })
  }
}

const FILES = [
  'user_books',
  'user_book_reads',
  'books',
  'editions',
  'lists',
  'list_books',
  'book_series',
  'series',
  'publishers',
  'languages',
  'contributions',
  'authors',
] as const

// ------------------------------------------------------------------ zip-level mischief

/**
 * Rewrites the size a zip's central directory declares for an entry (what fflate trusts to size its buffer): a header that
 * lies. The compressed bytes stay as they are.
 */
export function lieAboutSize(zip: Uint8Array, name: string, declared: number): Uint8Array {
  const copy = zip.slice()
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  let found = false
  for (let at = 0; at + 46 <= copy.length; at++) {
    if (view.getUint32(at, true) !== 0x02014b50) continue
    const length = view.getUint16(at + 28, true)
    if (new TextDecoder().decode(copy.subarray(at + 46, at + 46 + length)) !== name) continue
    view.setUint32(at + 24, declared, true)
    found = true
  }
  if (!found) throw new Error(`no entry ${name} in the zip`)
  return copy
}

/** A zip of this many small entries (more than the central directory may hold). */
export function manyEntries(count: number): Uint8Array {
  return zipSync(Object.fromEntries(Array.from({ length: count }, (_, index) => [`f${index}.txt`, strToU8('x')])), { level: 0 })
}

// ------------------------------------------------------------------ accounts

/**
 * The account most tests read: every status, every precision, re-reads, undated reads, a DNF with and without a day, open reads
 * with a page, a percent, seconds and nothing, a page past the page count, half-star ratings, the three review forms and a
 * rating-only review, owned, edition fallbacks, empty edition formats, audio and ebook, ranked and unranked lists, an empty
 * list, a contributed list, a list-only book on two lists, a cover under 150 px and one on another host.
 * The titles name the case ("Test Book: Read twice"); `ids` finds a book's row by its name.
 */
export function fullAccount(): { account: Account; ids: Record<string, number> } {
  const account = new Account()
  const ids: Record<string, number> = {}
  let isbn = 1
  /** A book with an edition (ISBN, pages, language, publisher) and its entry on a shelf. */
  const entry = (name: string, spec: ShelveSpec, book: Omit<BookSpec, 'title'> = {}, edition: EditionSpec | false = {}) => {
    const works = account.book({ title: `Test Book: ${name}`, pages: 300, year: 1999, ...book })
    const editionId = edition === false ? null : account.edition(works, { isbn13: testIsbn(isbn++), pages: 320, language: 'en', publisher: 'Test Press', year: 2010, format: 'Paperback', ...edition })
    account.shelve(works, { edition: editionId, ...spec })
    ids[name] = works
    return { works, editionId }
  }

  entry('Read once', { status: 3, rating: '4.5', reads: [{ started: '2024-03-01', finished: '2024-03-20' }] }, { authors: ['Ada Author', ['Tina Translator', 'Translator']] })
  entry('Read twice', { status: 3, rating: '3', reads: [{ started: '2022-01-01', finished: '2022-01-10' }, { started: '2024-05-01', finished: '2024-05-09' }] })
  entry('Read undated', { status: 3, rating: '5', reads: [{ finished: null, precision: 0 }] })
  entry('Read month', { status: 3, reads: [{ finished: '2023-06-01', precision: 2 }] })
  entry('Read year', { status: 3, reads: [{ finished: '2021-01-01', precision: 3 }] })
  entry('Read three', { status: 3, reads: [{ finished: '2019-01-01', precision: 3 }, { finished: null, precision: 0 }, { started: '2020-02-01', finished: '2020-02-09' }] })
  entry('Read no reads', { status: 3, rating: '2.5' })
  entry('Review markdown', { status: 3, review: { markdown: 'A **good** book.\n\nTwo paragraphs.', raw: 'ignored' }, reads: [{ finished: '2024-01-02' }] })
  entry('Review raw', { status: 3, review: { raw: 'Plain words.' }, reads: [{ finished: '2024-01-03' }] })
  entry('Review html', { status: 3, review: { html: '<p>Only <em>html</em> &amp; more.</p>' }, reads: [{ finished: '2024-01-04' }] })
  entry('Review rating only', { status: 3, rating: '3', review: { markdown: '4.5' }, reads: [{ finished: '2024-01-05' }] })
  entry('Owned', { status: 1, owned: true })
  entry('Want', { status: 1, rating: '4' })
  entry('Reading page', { status: 2, reads: [{ started: '2024-09-01', pages: 120, percent: 37.5 }] })
  entry('Reading percent', { status: 2, reads: [{ started: '2024-09-02', percent: 41.6 }] }, { pages: null }, { pages: null })
  entry('Reading past the end', { status: 2, reads: [{ started: '2024-09-03', pages: 900, percent: 22 }] })
  entry('Reading audio', { status: 2, reads: [{ started: '2024-09-04', seconds: 9_000, percent: null }] }, { audioSeconds: 36_000 }, { format: 'Audiobook', readingFormat: 2, audioSeconds: 36_000, pages: null })
  entry('Reading nothing', { status: 2, reads: [{ started: '2024-09-05' }] })
  entry('Reading no start', { status: 2, addedOn: '2024-08-08', reads: [{}] })
  entry('Reading again', { status: 2, reads: [{ started: '2020-01-01', finished: '2020-01-31' }, { started: '2024-09-06', pages: 10 }] })
  entry('Paused', { status: 4, reads: [{ started: '2024-07-01', paused: '2024-07-20', pages: 50 }] })
  entry('DNF day', { status: 5, rating: '2', reads: [{ started: '2024-04-01', finished: '2024-04-08', pages: 80 }] })
  entry('DNF paused', { status: 5, reads: [{ started: '2024-04-02', paused: '2024-04-09', percent: 12 }] })
  entry('DNF bare', { status: 5, reads: [{}] })
  entry('Ignored', { status: 6 })
  entry('Audio format', { status: 1 }, {}, { format: null, readingFormat: 2 })
  entry('Ebook format', { status: 1 }, {}, { format: '', readingFormat: 4 })
  entry('No edition', { status: 1 }, { pages: 222, year: 1988 }, false)
  // Edition fallbacks: the one a read names, the book's default, none that belongs to the book.
  {
    const works = account.book({ title: 'Test Book: Edition from read', pages: 300, year: 1999 })
    const named = account.edition(works, { isbn13: testIsbn(901), pages: 444, language: 'en', publisher: 'Read Press', year: 2012 })
    account.shelve(works, { status: 3, reads: [{ finished: '2024-02-02', edition: named }] })
    ids['Edition from read'] = works
    const by = account.book({ title: 'Test Book: Edition default', pages: 300 })
    const fallback = account.edition(by, { isbn13: testIsbn(902), pages: 555, language: 'de', publisher: 'Default Press' })
    account.records().books!.find((rec) => rec.id === by)!.default_physical_edition_id = fallback
    account.shelve(by, { status: 1 })
    ids['Edition default'] = by
    const foreign = account.book({ title: 'Test Book: Edition foreign' })
    const other = account.edition(by, { isbn13: testIsbn(903), pages: 777 })
    account.shelve(foreign, { status: 1, edition: other })
    ids['Edition foreign'] = foreign
  }
  entry('Series', { status: 1 }, { series: [{ name: 'Test Saga', position: 2, featured: true }, { name: 'Other Saga', position: 1, featured: false }] })
  entry('Series unnumbered', { status: 1 }, { series: [{ name: 'Test Saga', position: null }] })
  entry('Title in series (Test Saga, #3)', { status: 1 })
  entry('Small cover', { status: 1 }, { cover: { width: 100, height: 140 } }, { cover: { width: 100, height: 140 } })
  entry('Other host', { status: 1 }, { cover: { url: 'https://example.invalid/c.jpg' } }, { cover: { url: 'https://example.invalid/c.jpg' } })
  entry('No cover', { status: 1 }, { cover: null }, { cover: null })
  entry('Invalid ISBN', { status: 1 }, {}, { isbn13: '9790000000000', isbn10: null })
  entry('Isbn10 only', { status: 1 }, {}, { isbn13: null, isbn10: '0306406152' })

  // Lists: ranked, unranked, empty, someone else's; a library book on lists; list-only books (one on two lists).
  const ranked = account.list('Test Ranked', { ranked: true })
  const plain = account.list('Test Plain')
  account.list('Test Empty')
  const others = account.list('Test Someone Elses', { owner: account.userId + 1 })
  const long = account.list('L'.repeat(81))
  const first = account.book({ title: 'Test Book: List only one' })
  const firstEdition = account.edition(first, { isbn13: testIsbn(900), pages: 111, language: 'de', publisher: 'Liste Press', format: 'Hardcover' })
  const second = account.book({ title: 'Test Book: List only two', authors: ['Lena Lister'] })
  const third = account.book({ title: 'Test Book: List only three' })
  const fourth = account.book({ title: 'Test Book: Others only' })
  const fifth = account.book({ title: 'Test Book: Long name only' })
  account.onList(ranked, second, { position: 2, addedAt: '2024-03-02T08:00:00.000Z' })
  account.onList(ranked, ids['Read once']!, { position: 1, addedAt: '2024-03-03T08:00:00.000Z' })
  account.onList(ranked, first, { position: null, edition: firstEdition, addedAt: '2024-03-01T08:00:00.000Z' })
  account.onList(ranked, ids['Want']!, { position: 3, addedAt: '2024-03-04T08:00:00.000Z' })
  account.onList(plain, first, { edition: firstEdition, addedAt: '2024-01-15T08:00:00.000Z' })
  account.onList(plain, third, { addedAt: '2024-02-15T08:00:00.000Z' })
  account.onList(plain, ids['Read twice']!)
  account.onList(others, fourth)
  account.onList(long, fifth)
  ids['List only one'] = first
  ids['List only two'] = second
  ids['List only three'] = third
  ids['Others only'] = fourth
  ids['Long name only'] = fifth
  return { account, ids }
}

/** A deterministic scrap of invented text (words from a small alphabet), about `length` characters: the weight of a real book's cached tags and counts. */
function filler(seed: number, length: number): string {
  let state = seed * 2654435761 + 1
  let out = ''
  while (out.length < length) {
    state = (state * 1103515245 + 12345) % 2147483648
    out += `${(state % 9973).toString(36)}${state % 7 === 0 ? ' ' : ''}`
  }
  return out.slice(0, length)
}

/** Many books (about 7 kB of JSON a book, as a real export's `books.json`), for the timing of a big library. */
export function bigAccount(books: number): Account {
  const account = new Account()
  const list = account.list('Test Big List', { ranked: true })
  for (let index = 0; index < books; index++) {
    const book = account.book({ title: `Test Book ${index}`, pages: 200 + (index % 300), year: 1950 + (index % 70), authors: [`Author ${index % 400}`] })
    account.records().books!.find((rec) => rec.id === book)!.cached_tags = { filler: filler(index, 5_500) }
    const edition = account.edition(book, { isbn13: testIsbn(index + 10_000), pages: 250, language: index % 3 ? 'en' : 'de', publisher: `Press ${index % 50}`, format: 'Paperback' })
    const status = ([1, 2, 3, 3, 3, 5] as const)[index % 6]!
    account.shelve(book, {
      status,
      edition,
      rating: status === 3 ? '4' : null,
      reads: status === 1 ? [] : [{ started: '2023-01-01', finished: status === 2 ? null : '2023-02-01', pages: status === 2 ? 40 : null }],
    })
    if (index % 5 === 0) account.onList(list, book, { position: index })
  }
  return account
}
