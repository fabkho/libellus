import type { LibraryBook, LibraryBookAssets, RegalLibraryFile } from './regalLibraryFile'

/**
 * Carrying published art over (issue #22): the Books Regal already shows keep
 * their images. Regal's portfolio has Spine and back art for its Books (paid
 * AI art, photos) that Libellus does not know of; an export with only the
 * Cover would make Regal assets drop it. Given the library file that is
 * published now, every exported Book that was in it takes that Book's whole
 * `assets` (front, Spine, back, pile copies, palette, Spine colour, photo
 * faces, source), so its faces stay one consistent set; Books it does not
 * know keep the Libellus Cover and colours.
 *
 * A Book is found by its ISBN-13 first, then by its work: the title (without
 * a series in brackets or a subtitle after a colon, case, accents and
 * punctuation ignored) and the first author's surname. So a Book whose
 * edition Libellus changed (another ISBN, a slightly different title) still
 * finds its art. A title that two published Books share is not matched, and no
 * published Book lends its art twice.
 *
 * Published art is sticky: a matched Book shows the published front even when
 * its Libellus Cover changes. Pure; `resolveRef` turns an image reference of
 * the published file (relative to that file) into one that works from the
 * exported file, or null when it cannot.
 */

export type CarriedArt = {
  id: string
  title: string
  /** The published Book it took the art from. */
  from: string
  by: 'isbn13' | 'work'
}

export type CarryArtResult = {
  file: RegalLibraryFile
  carried: CarriedArt[]
  /** Exported Books the published file has no art for. */
  unmatched: LibraryBook[]
}

const SURNAME_PARTICLES = /^(jr|sr|ii|iii|iv)$/

const normalise = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** The work a Book is an edition of: its bare title and its first author's surname. */
export function workKey(book: Pick<LibraryBook, 'title' | 'authors'>): string {
  const title = normalise(book.title.replace(/\s*[([].*?[)\]]\s*/g, ' ').split(':')[0]!)
  const names = normalise(book.authors[0] ?? '').split(' ').filter((part) => !SURNAME_PARTICLES.test(part))
  return `${title}|${names.at(-1) ?? ''}`
}

function resolveAssets(assets: LibraryBookAssets, resolveRef: (ref: string) => string | null): LibraryBookAssets {
  const ref = (value: string | null | undefined) => (value ? resolveRef(value) : null)
  const result: LibraryBookAssets = {}
  for (const face of ['front', 'spine', 'back'] as const) {
    const resolved = ref(assets[face])
    if (resolved) result[face] = resolved
  }
  if (assets.pile) {
    const pile = { front: ref(assets.pile.front), spine: ref(assets.pile.spine) }
    if (pile.front || pile.spine) {
      result.pile = {}
      if (pile.front) result.pile.front = pile.front
      if (pile.spine) result.pile.spine = pile.spine
    }
  }
  if (assets.palette) result.palette = { ...assets.palette }
  if (assets.spineColor) result.spineColor = assets.spineColor
  if (assets.photoFaces?.length) result.photoFaces = [...assets.photoFaces]
  if (assets.source) result.source = assets.source
  return result
}

export function carryArt(file: RegalLibraryFile, published: RegalLibraryFile, resolveRef: (ref: string) => string | null): CarryArtResult {
  const withArt = published.books.filter((book) => book.assets && Object.keys(book.assets).length)
  const byIsbn = new Map<string, LibraryBook>()
  const byWork = new Map<string, LibraryBook | null>()
  for (const book of withArt) {
    if (book.isbn13 && !byIsbn.has(book.isbn13)) byIsbn.set(book.isbn13, book)
    const key = workKey(book)
    byWork.set(key, byWork.has(key) ? null : book)
  }

  const used = new Set<LibraryBook>()
  const found = new Map<LibraryBook, { source: LibraryBook; by: CarriedArt['by'] }>()
  // ISBN-13 first, over all Books, so a work match never takes an edition another Book has exactly.
  for (const book of file.books) {
    const source = book.isbn13 ? byIsbn.get(book.isbn13) : undefined
    if (source && !used.has(source)) {
      used.add(source)
      found.set(book, { source, by: 'isbn13' })
    }
  }
  for (const book of file.books) {
    if (found.has(book)) continue
    const source = byWork.get(workKey(book))
    if (source && !used.has(source)) {
      used.add(source)
      found.set(book, { source, by: 'work' })
    }
  }

  const carried: CarriedArt[] = []
  const unmatched: LibraryBook[] = []
  const books = file.books.map((book) => {
    const match = found.get(book)
    if (!match) {
      unmatched.push(book)
      return book
    }
    const art = resolveAssets(match.source.assets!, resolveRef)
    carried.push({ id: book.id, title: book.title, from: match.source.id, by: match.by })
    // The published set wins face by face; what it lacks, the Libellus Cover fills.
    const { assets: own, ...rest } = book
    return { ...rest, assets: { ...own, ...art } }
  })
  return { file: { ...file, books }, carried, unmatched }
}
