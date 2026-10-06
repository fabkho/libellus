import { unzipSync } from 'fflate'
import { isbn10To13, isValidIsbn10, isValidIsbn13 } from '../books'

/**
 * What an EPUB says about itself (issue #131): its package document (the OPF,
 * found through `META-INF/container.xml`) names the title, the creators, the
 * language, the publisher and the identifiers, and points at the cover image.
 * Read with fflate from the file's bytes, inflating only the container, the
 * OPF and (asked for) the cover; never the chapters.
 *
 * No DOM: this runs in a worker (data/ebooks/worker.ts), where there is no
 * DOMParser, and in Vitest. The OPF is well-formed XML with flat metadata, so a
 * small tag reader does: the elements by local name, their attributes and
 * their text. Framework-free; a native port reads the same fields.
 */

export type EpubMetadata = {
  title: string | null
  /** The authors as the book credits them, "First Last" ("Tolstoy, Leo" is turned round). Editors, translators and illustrators left out when the file says so. */
  authors: string[]
  language: string | null
  publisher: string | null
  /** Every ISBN the file carries, as ISBN-13 (an ISBN-10 converted), no duplicates. */
  isbns: string[]
  /** The raw `dc:identifier` values, for the record. */
  identifiers: string[]
  /** The cover image's path inside the zip, null when the file names none. */
  coverPath: string | null
  coverType: string | null
}

export type EpubContents = EpubMetadata & { cover: Uint8Array | null }

/** Why a file could not be read: not a zip at all, or a zip without an EPUB package document. */
export class EpubError extends Error {
  constructor(readonly code: 'not_epub' | 'no_package') {
    super(code)
    this.name = 'EpubError'
  }
}

// -------------------------------------------------------------------- reading XML

type Element = { name: string; attrs: Record<string, string>; text: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const point = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

function attributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = decodeEntities(match[2] ?? match[3] ?? '')
    attrs[match[1]!] = value
    // Also by local name ("opf:scheme" → "scheme"), unless the plain one is there too.
    const local = match[1]!.split(':').pop()!
    if (!(local in attrs)) attrs[local] = value
  }
  return attrs
}

/** Comments out, CDATA as plain text. */
function clean(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
}

/** Every element with this local name (any prefix), its attributes and its text with inner tags removed. */
function elements(xml: string, localName: string): Element[] {
  const name = localName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`<((?:[\\w.-]+:)?${name})(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</\\1\\s*>)`, 'g')
  return [...xml.matchAll(pattern)].map((match) => ({
    name: match[1]!,
    attrs: attributes(match[2] ?? ''),
    text: decodeEntities((match[3] ?? '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(),
  }))
}

// ---------------------------------------------------------------------- the rules

/**
 * The ISBN an identifier stands for, as ISBN-13, or null. `urn:isbn:…`, `isbn:…`
 * and an identifier the file labels ISBN (EPUB 2's `opf:scheme`, EPUB 3's
 * `identifier-type` refinement) are read as one; otherwise only a bare 13-digit
 * number that is a valid ISBN-13 counts (a bare 10-digit number could be any id).
 */
export function isbnOfIdentifier(value: string, labelledIsbn = false): string | null {
  const prefixed = /^(?:urn:)?isbn:?\s*/i.test(value.trim())
  const compact = value
    .trim()
    .replace(/^(?:urn:)?isbn:?\s*/i, '')
    .replace(/[\s‐-―-]/g, '')
    .toUpperCase()
  if (isValidIsbn13(compact)) return compact
  if ((prefixed || labelledIsbn) && isValidIsbn10(compact)) return isbn10To13(compact)
  return null
}

/** "Tolstoy, Leo, graf" → "Leo Tolstoy"; "Leo Tolstoy" stays. */
export function displayName(name: string): string {
  const parts = name.split(',').map((part) => part.trim())
  if (parts.length < 2 || !parts[0] || !parts[1] || /^(jr|sr|ii|iii|iv)\.?$/i.test(parts[1])) return name.trim()
  // Life dates ("1828-1910") and titles after the second comma are not part of the name.
  return `${parts[1]} ${parts[0]}`.replace(/\s+/g, ' ')
}

/** MARC relator codes that are not the author. */
const NOT_AUTHORS = new Set(['edt', 'trl', 'ill', 'ed', 'aui', 'aft', 'ann', 'bkp', 'cov', 'dsr', 'nrt', 'pbl', 'red', 'mrk', 'prf', 'ctb'])

/** Reads the package document (the OPF's text). */
export function readPackage(opf: string, opfPath: string): EpubMetadata {
  const xml = clean(opf)
  const metadataBlock = /<(?:[\w.-]+:)?metadata\b[\s\S]*?<\/(?:[\w.-]+:)?metadata\s*>/.exec(xml)?.[0] ?? xml
  const metas = elements(metadataBlock, 'meta')
  /** EPUB 3 refinements: `<meta refines="#id" property="…">value</meta>`. */
  const refinement = (id: string | undefined, property: string) =>
    id ? metas.find((meta) => meta.attrs.refines === `#${id}` && meta.attrs.property === property)?.text ?? null : null

  const titles = elements(metadataBlock, 'title').filter((title) => title.text)
  const main = titles.find((title) => refinement(title.attrs.id, 'title-type') === 'main') ?? titles[0]

  const authors = elements(metadataBlock, 'creator')
    .filter((creator) => {
      const role = (creator.attrs.role ?? refinement(creator.attrs.id, 'role') ?? 'aut').toLowerCase()
      return creator.text && !NOT_AUTHORS.has(role)
    })
    .map((creator) => {
      // The sort name ("Tolstoy, Leo, graf") turned round is the plainest form: Gutenberg writes "graf Leo Tolstoy" as the name.
      const fileAs = creator.attrs['file-as'] ?? refinement(creator.attrs.id, 'file-as')
      return fileAs?.includes(',') ? displayName(fileAs) : displayName(creator.text)
    })

  const identifierElements = elements(metadataBlock, 'identifier').filter((id) => id.text)
  const isbns: string[] = []
  for (const id of identifierElements) {
    const type = refinement(id.attrs.id, 'identifier-type')
    const labelled = /isbn/i.test(id.attrs.scheme ?? '') || /^(02|15|isbn)$/i.test(type ?? '')
    const isbn = isbnOfIdentifier(id.text, labelled)
    if (isbn && !isbns.includes(isbn)) isbns.push(isbn)
  }

  // The cover: EPUB 3's `properties="cover-image"`, else EPUB 2's `<meta name="cover" content="<item id>">`,
  // else an image item that calls itself the cover.
  const items = elements(xml, 'item')
  const coverId = metas.find((meta) => meta.attrs.name === 'cover')?.attrs.content
  const cover =
    items.find((item) => (item.attrs.properties ?? '').split(/\s+/).includes('cover-image')) ??
    items.find((item) => coverId && item.attrs.id === coverId && /^image\//.test(item.attrs['media-type'] ?? '')) ??
    items.find((item) => /^image\//.test(item.attrs['media-type'] ?? '') && /cover/i.test(`${item.attrs.id ?? ''} ${item.attrs.href ?? ''}`))
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  return {
    title: main?.text || null,
    authors,
    language: elements(metadataBlock, 'language')[0]?.text || null,
    publisher: elements(metadataBlock, 'publisher')[0]?.text || null,
    isbns,
    identifiers: identifierElements.map((id) => id.text),
    coverPath: cover?.attrs.href ? resolvePath(base, cover.attrs.href) : null,
    coverType: cover?.attrs['media-type'] ?? null,
  }
}

/** A zip path from the OPF's folder and an href relative to it (`../Images/c.jpg`, `%20`). */
export function resolvePath(base: string, href: string): string {
  let path = href.split('#')[0]!
  try {
    path = decodeURIComponent(path)
  } catch {
    // Kept as written.
  }
  const parts = (path.startsWith('/') ? path.slice(1) : base + path).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return out.join('/')
}

const decoder = new TextDecoder()

/** The rootfile the container names, or the first `.opf` in the zip. */
function packagePath(files: Record<string, Uint8Array>): string | null {
  const container = files['META-INF/container.xml']
  if (container) {
    const rootfile = elements(clean(decoder.decode(container)), 'rootfile').find(
      (file) => !file.attrs['media-type'] || file.attrs['media-type'] === 'application/oebps-package+xml',
    )
    const path = rootfile?.attrs['full-path']
    if (path && files[path]) return path
  }
  return Object.keys(files).find((name) => name.toLowerCase().endsWith('.opf')) ?? null
}

/**
 * Reads an EPUB's metadata from its bytes, and its cover image when `cover` is
 * true (a second pass that inflates only that entry). Throws `EpubError`.
 */
export function readEpub(bytes: Uint8Array, { cover = true }: { cover?: boolean } = {}): EpubContents {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter: (file) => file.name === 'META-INF/container.xml' || file.name.toLowerCase().endsWith('.opf') })
  } catch {
    throw new EpubError('not_epub')
  }
  const opfPath = packagePath(files)
  if (!opfPath) throw new EpubError('no_package')
  const metadata = readPackage(decoder.decode(files[opfPath]), opfPath)
  let image: Uint8Array | null = null
  if (cover && metadata.coverPath) {
    try {
      image = unzipSync(bytes, { filter: (file) => file.name === metadata.coverPath })[metadata.coverPath] ?? null
    } catch {
      image = null
    }
  }
  return { ...metadata, cover: image }
}
