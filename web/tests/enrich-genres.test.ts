import { describe, expect, it } from 'vitest'
import {
  APPLE_GENRES,
  GENRE_IDS,
  GENRE_MAP_VERSION,
  GENRES,
  genresOfSignal,
  type GenreSignal,
  isGenreId,
  mapGenres,
  WIKIDATA_GENRES,
} from '@/data/enrich/genres'
import { sql } from './support/stack'

/**
 * The canonical genre list and the mapping onto it (issue #168), pure: every
 * source's genre words land on one stable id, a genre never shows twice, a
 * Book gets three at most, unknown words are ignored, Wikidata comes first.
 * The list is the database's too (`genres`, seeded by the migration).
 */

const apple = (...values: string[]): GenreSignal[] => values.map((value) => ({ source: 'apple', value }))
const subjects = (...values: string[]): GenreSignal[] => values.map((value) => ({ source: 'openlibrary', value }))
const wikidata = (...ids: [string, string][]): GenreSignal[] => ids.map(([id, value]) => ({ source: 'wikidata', id, value }))
const ids = (signals: GenreSignal[]) => mapGenres(signals).map((g) => g.genre)

describe('the canonical list', () => {
  it('has about twenty stable ids, the ones the database seeds, in the same order', async () => {
    expect(GENRE_IDS).toEqual([
      'sci-fi', 'fantasy', 'horror', 'crime', 'thriller', 'romance', 'literary', 'historical', 'classics', 'ya',
      'graphic', 'poetry', 'short-stories', 'nonfiction', 'biography', 'history', 'science', 'philosophy',
      'self-help', 'essays',
    ])
    const rows = await sql<{ id: string; fiction: boolean }>('select id, fiction from public.genres order by position')
    expect(rows).toEqual(GENRES.map((g) => ({ id: g.id, fiction: g.fiction })))
    expect(GENRE_MAP_VERSION).toBeGreaterThan(0)
  })

  it('maps every table entry onto a canonical id', () => {
    for (const mapped of [...Object.values(APPLE_GENRES), ...Object.values(WIKIDATA_GENRES)]) {
      for (const id of mapped) expect(isGenreId(id)).toBe(true)
    }
  })
})

describe('mapping one signal', () => {
  it('reads Apple genre names, whatever the dash', () => {
    expect(genresOfSignal({ source: 'apple', value: 'Epic Fantasy' })).toEqual(['fantasy'])
    expect(genresOfSignal({ source: 'apple', value: 'High Tech Sci\u2011Fi' })).toEqual(['sci-fi'])
    expect(genresOfSignal({ source: 'apple', value: 'Biographies & Memoirs' })).toEqual(['biography'])
    expect(genresOfSignal({ source: 'apple', value: 'Sci-Fi & Fantasy' })).toEqual([])
    expect(genresOfSignal({ source: 'apple', value: 'Fiction & Literature' })).toEqual([])
  })

  it('reads Wikidata genre items by id, and an unlisted one by its label', () => {
    expect(genresOfSignal({ source: 'wikidata', id: 'Q24925', value: 'science fiction' })).toEqual(['sci-fi'])
    expect(genresOfSignal({ source: 'wikidata', id: 'Q8261', value: 'novel' })).toEqual([])
    expect(genresOfSignal({ source: 'wikidata', id: 'Q999999999', value: 'gothic horror' })).toEqual(['horror'])
  })

  it('reads Open Library subjects by keyword, and ignores the noise', () => {
    expect(genresOfSignal({ source: 'openlibrary', value: 'Fiction, science fiction, military' })).toEqual(['sci-fi'])
    expect(genresOfSignal({ source: 'openlibrary', value: 'Detective and mystery stories' })).toEqual(['crime'])
    // The umbrella heading "Science fiction, fantasy, horror" is shelved with any of them: horror is the odd one out.
    expect(genresOfSignal({ source: 'openlibrary', value: 'Science fiction, fantasy, horror' })).toEqual(['sci-fi', 'fantasy'])
    expect(genresOfSignal({ source: 'openlibrary', value: 'award:hugo_award=novel' })).toEqual([])
    expect(genresOfSignal({ source: 'openlibrary', value: 'Great Britain, history' })).toEqual(['history'])
    expect(genresOfSignal({ source: 'openlibrary', value: 'Historical fiction' })).toEqual(['historical'])
    expect(genresOfSignal({ source: 'openlibrary', value: 'Space warfare' })).toEqual(['sci-fi'])
    expect(genresOfSignal({ source: 'openlibrary', value: 'Brutha (Fictional character)' })).toEqual([])
  })
})

describe('a Book\'s genres', () => {
  it('never shows one genre twice, however many spellings say it', () => {
    const genres = ids([
      ...apple('Science Fiction', 'Adventure Sci-Fi', 'High Tech Sci-Fi'),
      ...wikidata(['Q24925', 'science fiction'], ['Q904447', 'military science fiction']),
      ...subjects('Science fiction', 'Fiction, science fiction, general'),
    ])
    expect(genres).toEqual(['sci-fi'])
  })

  it('has three at most, best first', () => {
    const genres = mapGenres([
      ...apple('Fantasy', 'Horror', 'Literary Fiction'),
      ...wikidata(['Q132311', 'fantasy'], ['Q193606', 'horror literature'], ['Q5937792', 'crime fiction'], ['Q858330', 'romance novel']),
    ])
    expect(genres).toHaveLength(3)
    expect(genres[0]).toEqual({ genre: 'fantasy', source: 'wikidata', confidence: 1 })
  })

  it('ignores what it does not know', () => {
    expect(ids([...apple('Books', 'Kids'), ...subjects('Accessible book', 'Protected DAISY', 'Fiction')])).toEqual([])
    expect(mapGenres([])).toEqual([])
  })

  it('puts Wikidata first: a shelf Apple also sells the Book on does not add a genre beside it', () => {
    // Small Gods: Wikidata says fantasy; Apple lists it under Horror and Science Fiction as well.
    const genres = ids([
      ...apple('Fantasy', 'Sci-Fi & Fantasy', 'Science Fiction', 'Horror'),
      ...wikidata(['Q132311', 'fantasy'], ['Q5977103', 'comic fantasy']),
      ...subjects('Science fiction', 'Fantasy fiction', 'Comics & graphic novels, fantasy'),
    ])
    expect(genres).toEqual(['fantasy'])
  })

  it('without Wikidata, Apple\'s primary genre counts most', () => {
    expect(ids(apple('Horror', 'Fiction & Literature'))).toEqual(['horror'])
    expect(ids(apple('Contemporary', 'Literary Fiction'))).toEqual([])
    expect(ids([...apple('Contemporary', 'Literary Fiction'), ...subjects('Fiction, literary', 'Psychological fiction')])).toEqual(['literary'])
  })

  it('needs two Open Library subjects to agree, and never takes a comic adaptation for a comic', () => {
    expect(ids(subjects('Fantasy fiction'))).toEqual([])
    expect(ids(subjects('Fantasy fiction', 'Fiction, fantasy, general'))).toEqual(['fantasy'])
    // The Forever War: a graphic adaptation files the novel under three comics subjects.
    expect(ids(subjects(
      'Science fiction comic books, strips', 'Comic books, strips', 'Comics & graphic novels, science fiction',
      'Fiction, science fiction, military', 'Space warfare',
    ))).toEqual(['sci-fi'])
  })

  it('does not call a novel history because its subjects name a place\'s history', () => {
    expect(ids([...apple('Historical Fiction'), ...subjects('Great Britain, history', 'England, history')])).toEqual(['historical'])
  })
})
