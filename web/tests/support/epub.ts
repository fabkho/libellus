import { strToU8, zipSync, type Zippable } from 'fflate'

/**
 * Small EPUB files for the tests (issue #131), built in memory with the
 * package documents of public-domain books as Project Gutenberg (EPUB 2) and
 * Standard Ebooks (EPUB 3) write them: the real metadata of the real editions,
 * one short chapter instead of the book. A file "with an ISBN" carries an
 * invented one (a valid check digit, never a real edition). Nothing is fetched.
 */

/** A 1 × 1 JPEG, the cover's stand-in. */
export const TINY_JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  ),
  (char) => char.charCodeAt(0),
)

export type EpubSpec = {
  version: 2 | 3
  title: string
  /** As the file writes them ("Melville, Herman" for Gutenberg's EPUB 3, "Herman Melville" elsewhere). */
  creators: { name: string; role?: string; fileAs?: string }[]
  language?: string
  publisher?: string
  identifiers?: { value: string; scheme?: string; type?: string }[]
  cover?: boolean
  /** Where the package document sits (`OEBPS/content.opf`). */
  opfPath?: string
  /** Text of the one chapter, so two files of the same book can differ. */
  body?: string
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function packageDocument(spec: EpubSpec): string {
  const ids = spec.identifiers ?? [{ value: `urn:uuid:${spec.title.length}-fixture` }]
  const v3 = spec.version === 3
  const creators = spec.creators
    .map((creator, i) =>
      v3
        ? `<dc:creator id="creator${i}">${esc(creator.name)}</dc:creator>` +
          (creator.role ? `<meta refines="#creator${i}" property="role" scheme="marc:relators">${creator.role}</meta>` : '') +
          (creator.fileAs ? `<meta refines="#creator${i}" property="file-as">${esc(creator.fileAs)}</meta>` : '')
        : `<dc:creator${creator.role ? ` opf:role="${creator.role}"` : ''}${creator.fileAs ? ` opf:file-as="${esc(creator.fileAs)}"` : ''}>${esc(creator.name)}</dc:creator>`,
    )
    .join('\n    ')
  const identifiers = ids
    .map((id, i) =>
      v3
        ? `<dc:identifier id="id${i}">${esc(id.value)}</dc:identifier>` +
          (id.type ? `<meta refines="#id${i}" property="identifier-type" scheme="onix:codelist5">${id.type}</meta>` : '')
        : `<dc:identifier id="id${i}"${id.scheme ? ` opf:scheme="${id.scheme}"` : ''}>${esc(id.value)}</dc:identifier>`,
    )
    .join('\n    ')
  const coverItem = spec.cover
    ? v3
      ? '<item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>'
      : '<item id="coverpage-image" href="images/cover.jpg" media-type="image/jpeg"/>'
    : ''
  const coverMeta = spec.cover && !v3 ? '<meta name="cover" content="coverpage-image" />' : ''
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${v3 ? '3.0' : '2.0'}" unique-identifier="id0"${v3 ? '' : ' xmlns:opf="http://www.idpf.org/2007/opf"'}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"${v3 ? '' : ' xmlns:opf="http://www.idpf.org/2007/opf"'}>
    <!-- ${v3 ? 'EPUB 3' : 'EPUB 2'} fixture -->
    <dc:title id="title">${esc(spec.title)}</dc:title>
    ${v3 ? '<meta refines="#title" property="title-type">main</meta>' : ''}
    ${creators}
    <dc:language>${spec.language ?? 'en'}</dc:language>
    ${spec.publisher ? `<dc:publisher>${esc(spec.publisher)}</dc:publisher>` : ''}
    ${identifiers}
    ${coverMeta}
  </metadata>
  <manifest>
    ${coverItem}
    <item id="chapter" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`
}

/** The EPUB's bytes: `mimetype` first and stored, the container, the package document, a chapter, the cover. */
export function buildEpub(spec: EpubSpec): Uint8Array {
  const opfPath = spec.opfPath ?? 'OEBPS/content.opf'
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    [opfPath]: strToU8(packageDocument(spec)),
    [`${base}text/chapter-1.xhtml`]: strToU8(
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(spec.title)}</title></head><body><p>${esc(spec.body ?? spec.title)}</p></body></html>`,
    ),
  }
  if (spec.cover) files[`${base}images/cover.jpg`] = [TINY_JPEG, { level: 0 }]
  // A fixed time on every entry, so the same spec always makes the same bytes (the same fingerprint).
  return zipSync(files, { mtime: new Date('2026-01-01T00:00:00Z') })
}

// ------------------------------------------------------------ public-domain books

/** Moby Dick as Project Gutenberg's EPUB 2 describes it (ebook #2701). */
export const MOBY_DICK_GUTENBERG: EpubSpec = {
  version: 2,
  title: 'Moby Dick; Or, The Whale',
  creators: [{ name: 'Herman Melville', role: 'aut', fileAs: 'Melville, Herman' }],
  publisher: 'Project Gutenberg',
  identifiers: [{ value: 'http://www.gutenberg.org/2701', scheme: 'URI' }],
  cover: true,
}

/** Anna Karenina as Standard Ebooks' EPUB 3 describes it (translated by Constance Garnett). */
export const ANNA_KARENINA_STANDARD: EpubSpec = {
  version: 3,
  title: 'Anna Karenina',
  creators: [
    { name: 'Leo Tolstoy', role: 'aut', fileAs: 'Tolstoy, Leo' },
    { name: 'Constance Garnett', role: 'trl', fileAs: 'Garnett, Constance' },
  ],
  publisher: 'Standard Ebooks',
  identifiers: [{ value: 'url:https://standardebooks.org/ebooks/leo-tolstoy/anna-karenina/constance-garnett' }],
  cover: true,
}

/** Dracula as Project Gutenberg's newer EPUB 3 writes it: the author "Last, First". */
export const DRACULA_GUTENBERG3: EpubSpec = {
  version: 3,
  title: 'Dracula',
  creators: [{ name: 'Stoker, Bram' }],
  publisher: 'Project Gutenberg',
  identifiers: [{ value: 'http://www.gutenberg.org/345' }],
  opfPath: '345/content.opf',
  cover: true,
}

/** Pride and Prejudice with an invented ISBN-13, as a publisher's EPUB 3 would carry it. */
export const prideAndPrejudiceWithIsbn = (isbn13: string): EpubSpec => ({
  version: 3,
  title: 'Pride and Prejudice',
  creators: [{ name: 'Jane Austen', role: 'aut' }],
  identifiers: [{ value: `urn:isbn:${isbn13}` }],
  cover: false,
})

/** An ISBN-13 with a valid check digit from its first twelve digits. */
export function withCheckDigit(first12: string): string {
  const sum = [...first12].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${first12}${(10 - (sum % 10)) % 10}`
}
