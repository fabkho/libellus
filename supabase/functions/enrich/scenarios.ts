/**
 * The Books the recorded tests replay (fixtures/<name>.json, recorded by
 * record_fixtures.ts): one each for the acceptance authors of issue #167 and
 * one nobody knows. The same list drives the recorder and the tests, so a
 * recording always matches what the tests ask.
 */
import type { BookRow } from './enrich.ts'

export const SCENARIOS = {
  // Terry Pratchett, Small Gods (Harper ebook, Apple): ISBN → Open Library → Wikidata;
  // Discworld 13; the author met for the first time (portrait, intro, works, sub-series).
  'pratchett-small-gods': {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Small Gods',
    authors: ['Terry Pratchett'],
    isbn13: '9780061803208',
    isbn10: null,
    language: 'en',
    apple_id: '363687952',
    openlibrary_edition_key: null,
    openlibrary_work_key: null,
  },
  // Ursula K. Le Guin, A Wizard of Earthsea (Open Library, by its work key, no ISBN):
  // Earthsea 1, standalones (The Dispossessed, The Lathe of Heaven) on her page.
  'le-guin-earthsea': {
    id: '00000000-0000-4000-8000-000000000002',
    title: 'A Wizard of Earthsea',
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    language: 'en',
    apple_id: null,
    openlibrary_edition_key: null,
    openlibrary_work_key: 'OL59860W',
  },
  // Joe Haldeman, The Forever War with John Scalzi's introduction credited:
  // Haldeman linked, Scalzi not; The Forever War series 1.
  'haldeman-forever-war': {
    id: '00000000-0000-4000-8000-000000000003',
    title: 'The Forever War',
    authors: ['Joe Haldeman', 'John Scalzi'],
    isbn13: '9781497692350',
    isbn10: null,
    language: 'en',
    apple_id: null,
    openlibrary_edition_key: null,
    openlibrary_work_key: 'OL271163W',
  },
  // J.K. Rowling, Harry Potter und der Feuerkelch (a German edition, Open Library): Wikidata's
  // series item had lost every label when this was recorded, so the series is named after Open
  // Library's. The author counts as fetched already (keeps the recording small).
  'rowling-feuerkelch': {
    id: '00000000-0000-4000-8000-000000000005',
    title: 'Harry Potter und der Feuerkelch',
    authors: ['J.K. Rowling'],
    isbn13: '9783551354044',
    isbn10: null,
    language: 'de',
    apple_id: null,
    openlibrary_edition_key: null,
    openlibrary_work_key: 'OL82560W',
  },
  // Nobody knows it: no ISBN, no key, a title and author no source has.
  'no-data': {
    id: '00000000-0000-4000-8000-000000000004',
    title: 'Qxzvbnm Wplkjhg',
    authors: ['Ann Zzyzx'],
    isbn13: null,
    isbn10: null,
    language: 'en',
    apple_id: null,
    openlibrary_edition_key: null,
    openlibrary_work_key: null,
  },
} satisfies Record<string, BookRow>

export type ScenarioName = keyof typeof SCENARIOS
/** Scenarios whose authors count as fetched within 30 days: only the Book is asked about. */
export const AUTHORS_FRESH: readonly ScenarioName[] = ['rowling-feuerkelch']
export const LANGUAGES = ['en', 'de'] as const
