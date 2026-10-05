/**
 * The tests' Library and published file: synthetic rows (fixtures/entries.json,
 * every case the mapping knows) and a published library file
 * (fixtures/published.json) at a made-up URL. Nothing here reaches the network
 * or a database.
 */
import type { EntryRow } from './library.ts'
import { type ExportConfig, loadPublished, type Published } from './handler.ts'
import type { RegalLibraryFile } from '../../../web/app/data/export/regalLibraryFile.ts'

export const TOKEN = 'test-token-0123456789abcdef0123456789abcdef'
export const OWNER_EMAIL = 'owner@libellus.test'
export const PUBLISHED_URL = 'https://books.example.test/v2/library.json'
export const NOW = new Date('2026-10-05T06:00:00Z')

const fixture = (name: string) => Deno.readTextFileSync(new URL(`./fixtures/${name}`, import.meta.url))

export const entryRows = (): EntryRow[] => JSON.parse(fixture('entries.json'))
export const publishedText = () => fixture('published.json')
export const expectedFile = (): RegalLibraryFile => JSON.parse(fixture('expected.json'))

export const config = (fields: Partial<ExportConfig> = {}): ExportConfig => ({
  token: TOKEN,
  ownerEmail: OWNER_EMAIL,
  ownerName: 'Fabian',
  timeZone: 'Europe/Berlin',
  statuses: ['read'],
  carryArtUrl: PUBLISHED_URL,
  ...fields,
})

/** A `fetch` that serves the published fixture at PUBLISHED_URL, and 404 elsewhere. */
export const publishedFetch = (body = publishedText(), status = 200): typeof fetch => (input) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url !== PUBLISHED_URL) return Promise.resolve(new Response('not found', { status: 404 }))
  const response = new Response(body, { status, headers: { 'content-type': 'application/json' } })
  Object.defineProperty(response, 'url', { value: url })
  return Promise.resolve(response)
}

export const fixturePublished = (): Promise<Published> => loadPublished(PUBLISHED_URL, publishedFetch())
