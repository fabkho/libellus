/**
 * The canonical genre list and the mapping onto it (issues #166, #168).
 *
 * Every source says "genre" in its own words: Apple Books in its genre names
 * ("Epic Fantasy", "Mysteries & Thrillers"), Wikidata in genre items (P136,
 * "Q24925 science fiction"), Open Library in free-text subjects ("Fiction,
 * science fiction, military", "Comic books, strips", "award:hugo_award=novel").
 * This module maps all of them onto one short list of stable ids, so a genre
 * never shows up twice in two spellings, and ranks what it finds: at most
 * three genres a Book.
 *
 * Shared, as it is, by the `enrich` edge function (which stores what it
 * computes in `book_genres` and `works.genre_ids`) and the app (labels, the
 * filter, the editor), so both read one list. Pure and framework-free: no I/O,
 * no Vue, imported by Deno with its `.ts` extension.
 *
 * Versioned: change a rule and bump GENRE_MAP_VERSION. The function keeps the
 * raw signals of every Book (`book_enrichment.signals`), so a new version is
 * applied to the whole Catalogue again without asking any source
 * (`enrich` action `remap`).
 */

export const GENRE_MAP_VERSION = 1

/** At most this many genres a Book, computed or set by hand. */
export const MAX_GENRES = 3

/**
 * The canonical list, in the order the app shows it. The ids are stable (they
 * are stored and used as i18n keys `genre.<id>`); the labels here are the
 * English ones the database seeds, for people reading SQL.
 */
export const GENRES = [
  { id: 'sci-fi', label: 'Science fiction', fiction: true },
  { id: 'fantasy', label: 'Fantasy', fiction: true },
  { id: 'horror', label: 'Horror', fiction: true },
  { id: 'crime', label: 'Crime & mystery', fiction: true },
  { id: 'thriller', label: 'Thriller', fiction: true },
  { id: 'romance', label: 'Romance', fiction: true },
  { id: 'literary', label: 'Literary fiction', fiction: true },
  { id: 'historical', label: 'Historical fiction', fiction: true },
  { id: 'classics', label: 'Classics', fiction: true },
  { id: 'ya', label: 'Young adult', fiction: true },
  { id: 'graphic', label: 'Graphic novels & comics', fiction: true },
  { id: 'poetry', label: 'Poetry', fiction: true },
  { id: 'short-stories', label: 'Short stories', fiction: true },
  { id: 'nonfiction', label: 'Non-fiction', fiction: false },
  { id: 'biography', label: 'Biography & memoir', fiction: false },
  { id: 'history', label: 'History', fiction: false },
  { id: 'science', label: 'Science', fiction: false },
  { id: 'philosophy', label: 'Philosophy', fiction: false },
  { id: 'self-help', label: 'Self-help', fiction: false },
  { id: 'essays', label: 'Essays', fiction: false },
] as const

export type GenreId = (typeof GENRES)[number]['id']

export const GENRE_IDS: readonly GenreId[] = GENRES.map((genre) => genre.id)

const POSITION = new Map<string, number>(GENRE_IDS.map((id, index) => [id, index]))
const FICTION = new Map<string, boolean>(GENRES.map((genre) => [genre.id, genre.fiction]))

export function isGenreId(value: unknown): value is GenreId {
  return typeof value === 'string' && POSITION.has(value)
}

/** Canonical order: what the list says first comes first. */
export function compareGenres(a: GenreId, b: GenreId): number {
  return POSITION.get(a)! - POSITION.get(b)!
}

// ------------------------------------------------------------------ signals

export type GenreSource = 'wikidata' | 'apple' | 'openlibrary'

/**
 * One thing a source said about a Book. `value` is the source's own word: an
 * Apple genre name, a Wikidata genre item's English label, an Open Library
 * subject; `id` is the Wikidata item (Q-id) when there is one.
 */
export type GenreSignal = { source: GenreSource; value: string; id?: string }

export type RankedGenre = {
  genre: GenreId
  /** The source that said it loudest. */
  source: GenreSource
  /** 0–1: how sure the mapping is (1 = Wikidata or two sources agree). */
  confidence: number
}

/** How much one match from a source is worth, and the most a source adds to one genre. */
const WEIGHT: Record<GenreSource, { each: number; cap: number }> = {
  wikidata: { each: 1, cap: 1 },
  // Apple's first genre is the Book's primary one; the rest are shelves it is
  // also sold on ("Horror" for Small Gods), worth less.
  apple: { each: 0.9, cap: 0.9 },
  // Open Library's subjects gather every edition's, translations and comic
  // adaptations included: one subject is a hint, two agreeing ones a genre.
  openlibrary: { each: 0.25, cap: 0.75 },
}

/** A genre needs this much before it is shown. */
export const THRESHOLD = 0.5
/**
 * Wikidata first (issue #166): where Wikidata names the Book's genres, another
 * genre needs this much from the other sources to join them.
 */
export const THRESHOLD_BESIDE_WIKIDATA = 0.9
/** Apple genres after the primary one. */
const APPLE_SECONDARY = 0.4

/**
 * Open Library subjects for these genres are mostly noise from one odd edition
 * (a comic adaptation of a novel files the work under "Comic books, strips"):
 * they can support a genre another source found but never make one alone.
 */
const OPEN_LIBRARY_WEAK: ReadonlySet<GenreId> = new Set(['graphic', 'short-stories', 'history', 'science', 'philosophy'])
const WEAK_EACH = 0.1

// ------------------------------------------------------------------ Apple

/**
 * Apple Books genre names (asked with `lang=en_us`, so in English whatever the
 * storefront), normalised by `normalize`. Umbrella genres that say nothing
 * ("Books", "Fiction & Literature", "Sci-Fi & Fantasy", "Kids") map to nothing.
 */
export const APPLE_GENRES: Readonly<Record<string, readonly GenreId[]>> = {
  'books': [],
  'fiction & literature': [],
  'sci-fi & fantasy': [],
  'action & adventure': [],
  'contemporary': [],
  'family fiction & literature': [],
  'kids': [],
  'science fiction': ['sci-fi'],
  'adventure sci-fi': ['sci-fi'],
  'high tech sci-fi': ['sci-fi'],
  'military sci-fi': ['sci-fi'],
  'space opera': ['sci-fi'],
  'cyberpunk': ['sci-fi'],
  'time travel': ['sci-fi'],
  'alien invasion': ['sci-fi'],
  'apocalyptic': ['sci-fi'],
  'dystopian': ['sci-fi'],
  'steampunk': ['sci-fi'],
  'fantasy': ['fantasy'],
  'epic fantasy': ['fantasy'],
  'urban fantasy': ['fantasy'],
  'dark fantasy': ['fantasy'],
  'historical fantasy': ['fantasy'],
  'humorous fantasy': ['fantasy'],
  'sword & sorcery': ['fantasy'],
  'fairy tales, myths & fables': ['fantasy'],
  'paranormal': ['fantasy'],
  'horror': ['horror'],
  'mysteries & thrillers': [],
  'mystery': ['crime'],
  'police procedural': ['crime'],
  'hard-boiled': ['crime'],
  'british detectives': ['crime'],
  'women sleuths': ['crime'],
  'cozy': ['crime'],
  'cozy mysteries': ['crime'],
  'traditional detectives': ['crime'],
  'historical mysteries': ['crime', 'historical'],
  'true crime': ['nonfiction'],
  'thriller': ['thriller'],
  'thrillers': ['thriller'],
  'suspense': ['thriller'],
  'psychological thrillers': ['thriller'],
  'espionage': ['thriller'],
  'political thrillers': ['thriller'],
  'legal thrillers': ['thriller'],
  'romance': ['romance'],
  'contemporary romance': ['romance'],
  'historical romance': ['romance', 'historical'],
  'paranormal romance': ['romance', 'fantasy'],
  'romantic suspense': ['romance', 'thriller'],
  'romantic comedy': ['romance'],
  'literary fiction': ['literary'],
  'literary': ['literary'],
  'classics': ['classics'],
  'historical fiction': ['historical'],
  'historical': ['historical'],
  'young adult': ['ya'],
  'teens': ['ya'],
  'comics & graphic novels': ['graphic'],
  'graphic novels': ['graphic'],
  'manga': ['graphic'],
  'comics': ['graphic'],
  'poetry': ['poetry'],
  'short stories': ['short-stories'],
  'anthologies': ['short-stories'],
  'biographies & memoirs': ['biography'],
  'biography': ['biography'],
  'memoirs': ['biography'],
  'autobiography': ['biography'],
  'history': ['history'],
  'world history': ['history'],
  'military history': ['history'],
  'ancient history': ['history'],
  'european history': ['history'],
  'science & nature': ['science'],
  'science': ['science'],
  'physics': ['science'],
  'astronomy': ['science'],
  'life sciences': ['science'],
  'nature': ['science'],
  'mathematics': ['science'],
  'philosophy': ['philosophy'],
  'religion & spirituality': ['nonfiction'],
  'self-improvement': ['self-help'],
  'self-help': ['self-help'],
  'health, mind & body': ['self-help'],
  'psychology': ['nonfiction'],
  'essays': ['essays'],
  'essays & travelogues': ['essays'],
  'business & personal finance': ['nonfiction'],
  'politics & current events': ['nonfiction'],
  'nonfiction': ['nonfiction'],
  'non-fiction': ['nonfiction'],
  'reference': ['nonfiction'],
  'travel & adventure': ['nonfiction'],
  'professional & technical': ['nonfiction'],
  'computers & internet': ['nonfiction'],
  'cookbooks, food & wine': ['nonfiction'],
}

// ---------------------------------------------------------------- Wikidata

/**
 * Wikidata genre items (P136) by Q-id. Items not listed here are matched by
 * their English label against the keyword rules below, so a sub-genre nobody
 * listed still lands where its name says.
 */
export const WIKIDATA_GENRES: Readonly<Record<string, readonly GenreId[]>> = {
  Q24925: ['sci-fi'], // science fiction
  Q3238422: ['sci-fi'], // science fiction literature
  Q12132683: ['sci-fi'], // science fiction novel
  Q468478: ['sci-fi'], // space opera
  Q174526: ['sci-fi'], // cyberpunk
  Q15062348: ['sci-fi'], // dystopian fiction
  Q358998: ['sci-fi'], // utopian and dystopian fiction
  Q904447: ['sci-fi'], // military science fiction
  Q725757: ['sci-fi'], // hard science fiction
  Q905770: ['sci-fi'], // soft science fiction
  Q944250: ['sci-fi'], // social science fiction
  Q2296283: ['sci-fi'], // New Wave science fiction
  Q197949: ['sci-fi'], // post-apocalyptic fiction
  Q132311: ['fantasy'], // fantasy
  Q1057172: ['fantasy'], // fantasy literature
  Q59342621: ['fantasy'], // fantasy novel
  Q326439: ['fantasy'], // high fantasy
  Q2625243: ['fantasy'], // heroic fantasy
  Q1637212: ['fantasy'], // fantasy comedy (comic fantasy)
  Q5977103: ['fantasy'], // comic fantasy
  Q794912: ['fantasy'], // dark fantasy
  Q1188977: ['fantasy'], // urban fantasy
  Q1999690: ['fantasy'], // sword and sorcery
  Q699: ['fantasy'], // fairy tale
  Q16575965: ['horror'], // horror fiction
  Q193606: ['horror'], // horror literature
  Q20667180: ['horror'], // horror novel
  Q192782: ['horror'], // Gothic novel
  Q732782: ['horror'], // weird fiction
  Q5937792: ['crime'], // crime fiction
  Q208505: ['crime'], // crime novel
  Q186424: ['crime'], // detective fiction
  Q20664817: ['crime'], // detective novel
  Q6585139: ['crime'], // mystery fiction
  Q121432200: ['crime'], // detective and mystery fiction
  Q182015: ['thriller'], // thriller
  Q590103: ['thriller'], // psychological thriller
  Q580850: ['thriller'], // techno-thriller
  Q20664331: ['thriller'], // spy fiction
  Q858330: ['romance'], // romance novel
  Q136472: ['historical'], // historical fiction (literature)
  Q1196408: ['historical'], // historical fiction
  Q192239: ['historical'], // historical novel
  Q111984153: ['ya'], // young adult fiction
  Q1233720: ['ya'], // young adult literature
  Q725377: ['graphic'], // graphic novel
  Q1004: ['graphic'], // comic
  Q482: ['poetry'], // poetry
  Q12106333: ['poetry'], // poetry collection
  Q49084: ['short-stories'], // short story
  Q1279564: ['short-stories'], // short story collection
  Q213051: ['nonfiction'], // non-fiction
  Q36279: ['biography'], // biography
  Q112983: ['biography'], // memoir
  Q4184: ['biography'], // autobiography
  Q5891: ['philosophy'], // philosophy
  Q35760: ['essays'], // essay
  Q3739522: ['self-help'], // self-help book
  Q995600: ['science'], // popular science
  // Genres that say nothing about which chip: a novel is a form, not a genre.
  Q8261: [], // novel
  Q149537: [], // novella
  Q9326077: [], // speculative fiction
  Q38072107: [], // fiction literature
  Q21802675: [], // adventure fiction
  Q223945: [], // Bildungsroman
}

// --------------------------------------------------- keyword rules (subjects)

type Rule = { genre: GenreId; match: RegExp; unless?: RegExp }

/**
 * Keyword rules over a normalised subject or label. Order does not matter: a
 * subject can match several rules ("science fiction, fantasy, horror"), and
 * then each genre gets a share of the subject's weight.
 */
export const KEYWORD_RULES: readonly Rule[] = [
  {
    genre: 'sci-fi',
    match: /\b(science fiction|sci-?fi|space opera|cyberpunk|dystopia[ns]?|time travel|post-?apocalyptic|steampunk|first contact|space warfare|interplanetary voyages|life on other planets|extraterrestrial|scientific romance|planetary romance|alternate history)\b/,
  },
  { genre: 'fantasy', match: /\b(fantasy|fantastic fiction|sword and sorcery|dragons|wizards|magic realism|fairy tales?)\b/ },
  { genre: 'horror', match: /\b(horror|ghost stories|vampires?|gothic|supernatural fiction|weird fiction)\b/, unless: /\bfantasy, horror\b/ },
  { genre: 'crime', match: /\b(detective|mystery|mysteries|crime|police procedural|murder|private investigators?)\b/, unless: /\btrue crime\b/ },
  { genre: 'thriller', match: /\b(thrillers?|suspense|espionage|spy stories|spies)\b/ },
  { genre: 'romance', match: /\b(romance|love stories|romantic)\b/, unless: /\b(romance (languages|philology)|scientific romance|planetary romance)\b/ },
  { genre: 'literary', match: /\b(literary fiction|fiction, literary|psychological fiction|philosophical fiction)\b/ },
  { genre: 'historical', match: /\b(historical fiction|fiction, historical|historical novels?|historical romance)\b/ },
  { genre: 'classics', match: /\b(classics?|classic literature)\b/ },
  { genre: 'ya', match: /\b(young adult|juvenile fiction|teen fiction|children'?s fiction|children'?s stories)\b/ },
  { genre: 'graphic', match: /^(comic books, strips|comics? and graphic novels|graphic novels?|comics?|manga)\b/ },
  { genre: 'poetry', match: /\b(poetry|poems|verse)\b/ },
  { genre: 'short-stories', match: /\b(short stories|short story|anthologies|anthology)\b/ },
  { genre: 'biography', match: /\b(biograph(y|ies|ical)|memoirs?|autobiograph(y|ies|ical)|diaries)\b/, unless: /\bfiction\b/ },
  { genre: 'history', match: /\bhistory\b/, unless: /\b(fiction|novels?|alternate history|future history)\b/ },
  { genre: 'science', match: /\b(popular science|physics|astronomy|cosmology|biology|evolution|mathematics|neuroscience|chemistry)\b/, unless: /\bfiction\b/ },
  { genre: 'philosophy', match: /\bphilosophy\b/, unless: /\bfiction\b/ },
  { genre: 'self-help', match: /\b(self-help|self-improvement|self-actualization|personal growth)\b/, unless: /\bfiction\b/ },
  { genre: 'essays', match: /\b(essays?)\b/ },
  { genre: 'nonfiction', match: /\b(non-?fiction)\b/ },
]

/** Subjects that only look like genres: awards, reading levels, collections, places. */
const SUBJECT_NOISE = /^(award:|nyt:|accessible book|protected daisy|in library|lending library|open library|long now|reading level|large type books|fiction in english|english fiction|fiction)$|^(award|nyt|series):/

// ----------------------------------------------------------------- mapping

/** Lower case, one kind of dash, "&" spelled out, no stray punctuation or spaces. */
export function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function keywordGenres(value: string): GenreId[] {
  const text = normalize(value).replace(/&/g, 'and')
  if (SUBJECT_NOISE.test(text)) return []
  const found: GenreId[] = []
  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(text) && !(rule.unless && rule.unless.test(text)) && !found.includes(rule.genre)) {
      found.push(rule.genre)
    }
  }
  // "science fiction" is not science; "historical fiction" is not history.
  if (found.includes('sci-fi')) remove(found, 'science')
  if (found.includes('historical')) remove(found, 'history')
  return found
}

function remove(list: GenreId[], genre: GenreId) {
  const index = list.indexOf(genre)
  if (index >= 0) list.splice(index, 1)
}

/** The canonical genres one signal names, before weighing. Unknown words map to none. */
export function genresOfSignal(signal: GenreSignal): GenreId[] {
  if (signal.source === 'apple') {
    const known = APPLE_GENRES[normalize(signal.value)]
    return known ? [...known] : keywordGenres(signal.value)
  }
  if (signal.source === 'wikidata') {
    const known = signal.id ? WIKIDATA_GENRES[signal.id] : undefined
    return known ? [...known] : keywordGenres(signal.value)
  }
  return keywordGenres(signal.value)
}

/**
 * The Book's genres, best first, at most `limit` (3): every signal mapped onto
 * the canonical list, weighed by source (Wikidata 1; Apple 0.9 for its primary
 * genre, 0.4 for the others; each Open Library subject 0.25, up to 0.75),
 * summed per genre, kept from THRESHOLD up (THRESHOLD_BESIDE_WIKIDATA for a
 * genre Wikidata did not name, where it named any).
 * One genre is one entry whatever spelled it. Where a fiction genre is sure
 * (≥ 0.9), non-fiction genres that are not are left out: a novel's subject
 * "Great Britain, history" does not make it a history book.
 */
export function mapGenres(signals: readonly GenreSignal[], limit: number = MAX_GENRES): RankedGenre[] {
  const scores = new Map<GenreId, Map<GenreSource, number>>()
  const seen = new Set<string>()
  const byWikidata = new Set<GenreId>()
  let appleIndex = 0
  for (const signal of signals) {
    const key = `${signal.source}|${signal.id ?? normalize(signal.value)}`
    if (seen.has(key)) continue
    seen.add(key)
    const primaryApple = signal.source === 'apple' && appleIndex++ === 0
    const genres = genresOfSignal(signal)
    if (!genres.length) continue
    for (const genre of genres) {
      if (signal.source === 'wikidata') byWikidata.add(genre)
      const weak = signal.source === 'openlibrary' && OPEN_LIBRARY_WEAK.has(genre)
      const each = weak ? WEAK_EACH : signal.source === 'apple' && !primaryApple ? APPLE_SECONDARY : WEIGHT[signal.source].each
      // A subject naming several genres ("science fiction, fantasy, horror") gives each a share.
      const share = each / (signal.source === 'openlibrary' ? genres.length : 1)
      const bySource = scores.get(genre) ?? new Map<GenreSource, number>()
      bySource.set(signal.source, (bySource.get(signal.source) ?? 0) + share)
      scores.set(genre, bySource)
    }
  }

  const ranked = [...scores.entries()].map(([genre, bySource]) => {
    let total = 0
    let loudest: GenreSource = 'openlibrary'
    let loudestScore = -1
    for (const [source, raw] of bySource) {
      const capped = Math.min(raw, WEIGHT[source].cap)
      total += capped
      if (capped > loudestScore) {
        loudest = source
        loudestScore = capped
      }
    }
    return { genre, source: loudest, score: total }
  })

  const sureFiction = ranked.some((entry) => FICTION.get(entry.genre) && entry.score >= 0.9)
  return ranked
    .filter((entry) => entry.score >= (byWikidata.size && !byWikidata.has(entry.genre) ? THRESHOLD_BESIDE_WIKIDATA : THRESHOLD))
    .filter((entry) => !(sureFiction && !FICTION.get(entry.genre) && entry.score < 0.9))
    .sort((a, b) => b.score - a.score || compareGenres(a.genre, b.genre))
    .slice(0, limit)
    .map((entry) => ({ genre: entry.genre, source: entry.source, confidence: Math.min(1, Math.round(entry.score * 100) / 100) }))
}
