import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  formatLibraryFileErrors,
  parseLibraryFile,
  validateLibraryFile,
  type LibraryFileError,
  type LibraryFileResult,
} from '@/data/export/regalLibraryFile'

/**
 * The vendored port of Regal's validator (app/data/export/regalLibraryFile.ts)
 * against Regal's own fixtures, copied into tests/fixtures/regal/ from the same
 * commit: the valid ones pass, the invalid ones fail at the paths and with the
 * messages Regal's tests expect. With `REGAL_DIR` set to a Regal checkout,
 * Regal's validator itself checks every fixture (the export's included) and
 * must agree with the port, so a format change in Regal shows up here.
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/regal/', import.meta.url))
const fixtureText = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')
const fixture = (name: string) => JSON.parse(fixtureText(name)) as Record<string, unknown>

function errorsOf(text: string): LibraryFileError[] {
  const result = parseLibraryFile(text)
  if (result.ok) throw new Error('expected the file to be invalid')
  return result.errors
}

const pathsOf = (errors: LibraryFileError[]) => errors.map((error) => error.path)

describe('the Regal library file validator (port)', () => {
  it.each(['demo.json', 'all-fields.json', 'minimal.json', 'libellus-export.json'])('accepts %s', (name) => {
    const data = fixture(name)
    expect(validateLibraryFile(data)).toEqual({ ok: true, library: data })
  })

  it('accepts a byte order mark and an empty Library', () => {
    expect(parseLibraryFile(`\uFEFF${fixtureText('minimal.json')}`).ok).toBe(true)
    expect(validateLibraryFile({ version: 2, generatedAt: '2026-05-01T06:00:00Z', books: [] }).ok).toBe(true)
  })

  it('reports JSON that does not parse, is not an object, or is another version', () => {
    const truncated = errorsOf(fixtureText('invalid/truncated.json'))
    expect(truncated).toHaveLength(1)
    expect(truncated[0]!.reason).toMatch(/^is not valid JSON/)
    expect(errorsOf(fixtureText('invalid/not-an-object.json'))).toEqual([{ path: '', reason: 'must be a JSON object, got an array' }])
    expect(errorsOf(fixtureText('invalid/wrong-version.json'))).toEqual([{ path: 'version', reason: 'must be 2, got 1' }])
    expect(pathsOf(errorsOf(fixtureText('invalid/reading-tracker-export.json')))).toEqual(['version'])
  })

  it('reports broken metadata', () => {
    expect(errorsOf(fixtureText('invalid/bad-metadata.json'))).toEqual([
      { path: 'generatedAt', reason: 'must be an ISO 8601 date-time with Z or an offset (2026-05-01T06:00:00Z), got "2026-05-01"' },
      { path: 'owner', reason: 'must be a string or null, got number' },
      { path: 'books', reason: 'must be an array, got an object' },
    ])
  })

  it('reports every broken Book field with its path', () => {
    const errors = errorsOf(fixtureText('invalid/bad-books.json'))
    expect(pathsOf(errors)).toEqual([
      'books[0]',
      'books[1].id',
      'books[1].title',
      'books[1].authors',
      'books[2].seriesTitle',
      'books[2].authors[1]',
      'books[2].isbn13',
      'books[2].isbn10',
      'books[2].pages',
      'books[2].yearPublished',
      'books[2].originalYear',
      'books[2].status',
      'books[2].dateRead',
      'books[2].dateStarted',
      'books[2].dateAdded',
      'books[2].rating',
      'books[2].review',
      'books[2].reviewHasSpoiler',
      'books[2].readCount',
      'books[2].description',
      'books[2].quotes[0].text',
      'books[2].quotes[0].source',
      'books[2].quotes[1]',
      'books[3].rating',
      'books[4].id',
    ])
    const reason = (path: string) => errors.find((error) => error.path === path)!.reason
    expect(reason('books[2].dateRead')).toBe('must be a date as YYYY-MM-DD or null, got "2026-02-30"')
    expect(reason('books[2].rating')).toBe('must be quarter stars from 0 to 5 (0, 0.25 … 5) or null, got 4.3')
    expect(reason('books[4].id')).toBe('must be unique, "too-many-stars" is also books[3].id')
  })

  it('reports broken assets with their path', () => {
    expect(errorsOf(fixtureText('invalid/bad-assets.json'))).toEqual([
      { path: 'books[0].assets.front', reason: 'must be an http(s) URL or a relative path, got a data: URL' },
      { path: 'books[0].assets.spine', reason: 'must be a URL without spaces, got "spine art.webp"' },
      { path: 'books[0].assets.back', reason: 'must be a URL or null, got number' },
      { path: 'books[0].assets.pile.front', reason: 'must be an http(s) URL or a relative path, got a javascript: URL' },
      { path: 'books[0].assets.palette.background', reason: 'must be a colour as #rrggbb, got "#fff"' },
      { path: 'books[0].assets.palette.accent', reason: 'is required in a palette (a colour as #rrggbb)' },
      { path: 'books[0].assets.spineColor', reason: 'must be a colour as #rrggbb, got "red"' },
      { path: 'books[0].assets.photoFaces[1]', reason: 'must be one of front, spine, back, got "side"' },
      { path: 'books[0].assets.source', reason: 'must be one of photo, ai or null, got "scan"' },
      { path: 'books[1].assets', reason: 'must be an object or null, got string' },
    ])
  })

  it('sums up errors beyond the first hundred, and formats errors as lines', () => {
    const books = Array.from({ length: 150 }, (_, index) => ({ id: `b${index}`, title: 'T', authors: [], status: 'read', rating: 9 }))
    const result = validateLibraryFile({ version: 2, generatedAt: '2026-05-01T06:00:00Z', books })
    expect(result.ok ? [] : result.errors.at(-1)).toEqual({ path: '', reason: '…and 50 more error(s)' })
    expect(formatLibraryFileErrors([{ path: 'books[2].rating', reason: 'must be …' }, { path: '', reason: 'is not valid JSON' }])).toEqual([
      'books[2].rating: must be …',
      '(file): is not valid JSON',
    ])
  })
})

// Regal's own validator, when a checkout is at hand (never in CI).
const regalDir = process.env.REGAL_DIR ? resolve(process.env.REGAL_DIR) : null
const regalValidator = regalDir ? join(regalDir, 'shared/library/libraryFile.ts') : null

describe.skipIf(!regalValidator || !existsSync(regalValidator))('Regal’s own validator (REGAL_DIR)', () => {
  const files = [
    ...readdirSync(FIXTURES).filter((name) => name.endsWith('.json')),
    ...readdirSync(join(FIXTURES, 'invalid')).map((name) => `invalid/${name}`),
  ]

  it.each(files)('agrees with the port on %s', async (name) => {
    const regal = (await import(/* @vite-ignore */ regalValidator!)) as { parseLibraryFile: (text: string) => LibraryFileResult }
    const text = fixtureText(name)
    expect(parseLibraryFile(text)).toEqual(regal.parseLibraryFile(text))
    if (!name.startsWith('invalid/')) expect(regal.parseLibraryFile(text).ok).toBe(true)
  })

  it('has the same fixtures as the checkout', () => {
    for (const name of files.filter((file) => file !== 'libellus-export.json')) {
      expect(fixtureText(name), name).toBe(readFileSync(join(regalDir!, 'tests/fixtures/library-file', name), 'utf8'))
    }
  })
})
