/**
 * Sample data for the design playground: Fabian's real books, out of his
 * reading-tracker database (`~/.reading-tracker/library.db`), with a few
 * invented extras so every state has something to show (one abandoned read, one
 * re-read with two sessions, reviews, collections, a Manual book).
 *
 * Words follow the glossary (CONTEXT.md): Book, Library entry, Reading session,
 * Collection, Status, Rating. Covers are Apple Books artwork at 600×900,
 * resolved once while writing this file — nothing is looked up at runtime.
 *
 * Plain TypeScript, no Vue: screens read it through `useProto().data` (see
 * README), which is this module's `sample` export.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The exclusive state of a Library entry, derived from its Reading sessions. */
export type Status = 'want_to_read' | 'reading' | 'finished'

export type BookSource = 'apple' | 'openlibrary' | 'manual' | 'import'

/** One edition of a title. */
export interface Book {
  id: string
  title: string
  /** Ordered; the first is the one shown when space is short. */
  authors: string[]
  isbn13: string | null
  pageCount: number | null
  /** Publication year of this edition. */
  year: number | null
  publisher: string | null
  description: string | null
  /** High-resolution cover, or null → draw a Placeholder cover. */
  coverUrl: string | null
  /** Colours sampled from the cover once, at write time. Null without a cover. */
  coverColors: CoverColors | null
  source: BookSource
}

/** A cover's palette, precomputed (never extracted at runtime). */
export interface CoverColors {
  /** The cover's main colour, `#rrggbb`. */
  dominant: string
  /** A clearly different second colour, `#rrggbb`. */
  secondary: string
  /** True when the cover is dark overall: put light text on it. */
  isDark: boolean
}

export type SessionOutcome = 'finished' | 'abandoned'

/** One read of a Library entry. `outcome: null` = open (currently reading). */
export interface ReadingSession {
  id: string
  /** ISO date `YYYY-MM-DD`. May be null on past reads. */
  startedOn: string | null
  endedOn: string | null
  outcome: SessionOutcome | null
  /** Integer quarter stars, 1–20 (= 0.25–5 stars). Null = unrated. Finished sessions only. */
  rating: number | null
  /** Closed sessions only. */
  review: string | null
  /** Abandoned sessions only. */
  abandonReason: string | null
}

/** One Book in the Member's Library. */
export interface LibraryEntry {
  id: string
  book: Book
  status: Status
  /** ISO date the entry was created. */
  addedOn: string
  /** Oldest first; the last one is the latest. Empty for *Want to read*. */
  sessions: ReadingSession[]
}

/** A Member's custom shelf. Order of `entryIds` is the Member's order. */
export interface Collection {
  id: string
  name: string
  entryIds: string[]
}

export type SearchSource = 'catalogue' | 'apple' | 'openlibrary'

/** One merged search hit. */
export interface SearchResult {
  id: string
  title: string
  authors: string[]
  year: number | null
  pageCount: number | null
  coverUrl: string | null
  coverColors: CoverColors | null
  source: SearchSource
  isbn13: string | null
  /** The Member's Status if this Book is in the Library, else null. */
  libraryStatus: Status | null
  /** True when the Library holds another edition (title + author match, no ISBN match). */
  otherEdition: boolean
}

// ---------------------------------------------------------------------------
// Helpers (pure, safe to call from any screen)
// ---------------------------------------------------------------------------

/** "Today" for every screen, so dates in frames never drift. */
export const today = '2026-10-02'

/** Quarter stars (1–20) → stars (0.25–5). */
export function stars(quarters: number): number {
  return quarters / 4
}

/** Quarter stars → "4.25". */
export function formatRating(quarters: number | null): string {
  return quarters == null ? '' : String(stars(quarters))
}

/** `2026-05-17` → "17 May 2026" (`long`), "17 May" (`short`), "May 2026" (`month`). */
export function formatDate(iso: string | null, style: 'long' | 'short' | 'month' = 'long'): string {
  if (!iso) return ''
  const date = new Date(`${iso}T12:00:00Z`)
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: 'numeric', month: 'short' }
      : style === 'month'
        ? { month: 'long', year: 'numeric' }
        : { day: 'numeric', month: 'short', year: 'numeric' }
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(date)
}

/** First author, or "A & B" for two, or "A et al." for more. */
export function formatAuthors(authors: string[]): string {
  if (authors.length <= 1) return authors[0] ?? ''
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`
  return `${authors[0]} et al.`
}

export function latestSession(entry: LibraryEntry): ReadingSession | null {
  return entry.sessions.at(-1) ?? null
}

/** The glossary's rule: no session → want; latest open → reading; latest closed → finished. */
function statusOf(sessions: ReadingSession[]): Status {
  const last = sessions.at(-1)
  if (!last) return 'want_to_read'
  return last.outcome ? 'finished' : 'reading'
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

const APPLE_PREFIX = 'https://is1-ssl.mzstatic.com/image/thumb/'
const APPLE_SUFFIX = '/600x900bb.jpg'
const apple = (path: string) => `${APPLE_PREFIX}${path}${APPLE_SUFFIX}`

/**
 * Cover colours, sampled from a 24×36 downscale of each cover (most frequent
 * colour bucket, weighted towards saturated ones; a second bucket far enough
 * away; mean luminance for `isDark`). Keyed by the Apple artwork path.
 */
const palette: Record<string, CoverColors> = {
  "Publication18/v4/cf/40/60/cf406087-2bbf-ed33-73ba-f6e6b2375bd9/mzm.jkfqpgso.jpg": { dominant: "#f8f8f9", secondary: "#afb9c7", isDark: false },
  "Publication211/v4/8c/aa/9d/8caa9d7e-fc0c-7e9b-c226-0581f81a9700/1059114320.jpg": { dominant: "#f9f9f7", secondary: "#2e2d4e", isDark: false },
  "Publication116/v4/0a/1a/2b/0a1a2b6b-68e1-1a34-55fb-c639267972fe/9780547724904.jpg": { dominant: "#0c0d0d", secondary: "#f3f4f3", isDark: true },
  "Publication/62/b5/91/mzi.ioyhzhmc.jpg": { dominant: "#364b29", secondary: "#5093af", isDark: true },
  "Publication122/v4/85/70/2f/85702f34-2982-e2ee-d883-b5ffc3ae0897/9781101658055.d.jpg": { dominant: "#eaac4b", secondary: "#502b2f", isDark: true },
  "Publication211/v4/13/fb/63/13fb6355-fce2-0e4b-08b7-48452037759a/9780593135211.d.jpg": { dominant: "#082d33", secondary: "#728c8e", isDark: true },
  "Publication122/v4/ed/e4/63/ede463a3-a899-9d31-ce86-98816dcb7181/9780307414090.d.jpg": { dominant: "#ebd8b1", secondary: "#b03228", isDark: false },
  "Publication6/v4/02/7c/aa/027caae8-d826-f17d-30a3-1e75d5bfd187/9781473208735.jpg": { dominant: "#927046", secondary: "#d0cd49", isDark: false },
  "Publication126/v4/60/17/9f/60179fef-f510-c89c-069d-f991996cf563/9780547840482.jpg": { dominant: "#080b0f", secondary: "#f8f7f8", isDark: false },
  "Publication125/v4/bf/1f/bc/bf1fbcda-11b3-4cee-2909-1104ebe422b6/9781590173930.jpg": { dominant: "#292a2e", secondary: "#988d75", isDark: true },
  "Publication122/v4/b4/b3/d5/b4b3d5b1-0dd6-abf5-7856-965e628b9fc1/9780547539638.jpg": { dominant: "#1d2b54", secondary: "#fbf7f2", isDark: true },
  "Publication211/v4/8b/c8/4a/8bc84a3e-bd3e-cabd-f5e2-a8739f9cad91/9780307781888.d.jpg": { dominant: "#f3cbb1", secondary: "#090b07", isDark: true },
  "Publication221/v4/68/a4/27/68a42789-85bc-1722-e189-39c761b494b2/1058359496.jpg": { dominant: "#f9f6f6", secondary: "#323131", isDark: false },
  "Publication116/v4/1c/df/f2/1cdff257-1ca4-1172-bfb2-95442f832c10/9780547999548.jpg": { dominant: "#f8f7f6", secondary: "#6f4c35", isDark: false },
  "Publication221/v4/1c/44/31/1c443129-5611-cb10-4e3d-2011fa0ac138/9781481424295.jpg": { dominant: "#54524d", secondary: "#af976c", isDark: true },
  "Publication113/v4/b1/c4/35/b1c4350e-2063-d273-2231-853bff00db6e/9780316068796.jpg": { dominant: "#342b68", secondary: "#d1b5d5", isDark: false },
  "Publication221/v4/c8/bf/b3/c8bfb35c-53b3-7373-ad0e-561c68761d74/9780593983768.d.jpg": { dominant: "#8f714d", secondary: "#0c0a09", isDark: true },
  "Publication128/v4/fb/d2/7f/fbd27fff-a426-6300-05a0-421b5653c9c1/9780316095839.jpg": { dominant: "#10b7d5", secondary: "#031a28", isDark: false },
  "Publication221/v4/9c/01/0c/9c010cd4-0857-1ddc-a5aa-416df2b5d7a8/9781982141196.jpg": { dominant: "#332a26", secondary: "#8e6c52", isDark: true },
  "Publication211/v4/33/13/9c/33139cdd-1a27-94a4-1d8e-29c3bbf39b38/9781101665398.d.jpg": { dominant: "#eff7f9", secondary: "#52b8cc", isDark: false },
  "Publication221/v4/6b/25/20/6b25209d-eb85-58fb-76cc-5e10da5604fa/9780063445796.jpg": { dominant: "#9491c6", secondary: "#f9f9f9", isDark: false },
  "Publication126/v4/e6/b4/61/e6b4611c-6763-ed18-fbef-aa3842472ae0/9780544084377.jpg": { dominant: "#2f376d", secondary: "#11090b", isDark: true },
  "Publication126/v4/5c/c8/fc/5cc8fc3b-6c10-9f41-ce1b-721159fa2d74/9781668014967.jpg": { dominant: "#f15555", secondary: "#51c8e9", isDark: false },
  "https://covers.openlibrary.org/b/id/6938605-L.jpg": { dominant: "#522d16", secondary: "#858f8f", isDark: true },
  "Publication211/v4/d8/83/55/d8835508-3e61-54ec-27e0-b6b4d0c86a76/9780547728247.jpg": { dominant: "#f7f7f8", secondary: "#908a94", isDark: false },
  "Publication211/v4/23/5e/19/235e19d5-cd0d-6b70-47c1-a08d232f0f7f/9780307781895.d.jpg": { dominant: "#f1a957", secondary: "#93a6b3", isDark: false },
  "Publication211/v4/f5/9a/55/f59a55c6-e662-8159-26bb-0d8d224def97/9780756420017.d.jpg": { dominant: "#f9f2ea", secondary: "#f8ce92", isDark: false },
}

function colorsFor(coverUrl: string | null): CoverColors | null {
  if (!coverUrl) return null
  return palette[coverUrl.replace(APPLE_PREFIX, '').replace(APPLE_SUFFIX, '')] ?? null
}

function book(
  id: string,
  fields: Partial<Omit<Book, 'coverColors'>> & Pick<Book, 'title' | 'authors' | 'pageCount'>,
): Book {
  return {
    id,
    isbn13: null,
    pageCount: null,
    year: null,
    publisher: null,
    description: null,
    coverUrl: null,
    source: 'import',
    ...fields,
    coverColors: colorsFor(fields.coverUrl ?? null),
  }
}

const books = {
  ruin: book('ruin', {
    title: 'Ruin',
    authors: ['John Gwynne'],
    isbn13: '9780316386302',
    pageCount: 800,
    year: 2015,
    description:
      'The Banished Lands are engulfed in war and chaos. The cunning Queen Rhin has conquered the west and High King Nathair has the cauldron, most powerful of the seven treasures.',
    coverUrl: apple('Publication18/v4/cf/40/60/cf406087-2bbf-ed33-73ba-f6e6b2375bd9/mzm.jkfqpgso.jpg'),
  }),
  carpetMakers: book('carpet-makers', {
    title: 'The Carpet Makers',
    authors: ['Andreas Eschbach'],
    isbn13: '9781466850224',
    pageCount: 261,
    year: 2013,
    publisher: 'Tor Books',
    description:
      'Since the time of pre-history, carpetmakers tie intricate knots to form carpets for the court of the Emperor. These carpets are made from the hairs of wives and daughters; they are so detailed and fragile that each carpetmaker finishes only one single carpet in his entire lifetime.',
    coverUrl: apple('Publication211/v4/8c/aa/9d/8caa9d7e-fc0c-7e9b-c226-0581f81a9700/1059114320.jpg'),
  }),
  flowMyTears: book('flow-my-tears', {
    title: 'Flow My Tears, the Policeman Said',
    authors: ['Philip K. Dick'],
    isbn13: '9780547724904',
    pageCount: 240,
    year: 2012,
    coverUrl: apple('Publication116/v4/0a/1a/2b/0a1a2b6b-68e1-1a34-55fb-c639267972fe/9780547724904.jpg'),
  }),
  wordForWorld: book('word-for-world', {
    title: 'The Word for World Is Forest',
    authors: ['Ursula K. Le Guin'],
    isbn13: '9781429983549',
    pageCount: 192,
    year: 2010,
    coverUrl: apple('Publication/62/b5/91/mzi.ioyhzhmc.jpg'),
  }),
  dune: book('dune', {
    title: 'Dune',
    authors: ['Frank Herbert'],
    isbn13: '9781101658055',
    pageCount: 896,
    year: 2003,
    publisher: 'Ace',
    description:
      "Set on the desert planet Arrakis, Dune is the story of Paul Atreides—who would become known as Muad'Dib—and of a great family's ambition to bring to fruition mankind's most ancient and unattainable dream.",
    coverUrl: apple('Publication122/v4/85/70/2f/85702f34-2982-e2ee-d883-b5ffc3ae0897/9781101658055.d.jpg'),
  }),
  projectHailMary: book('project-hail-mary', {
    title: 'Project Hail Mary',
    authors: ['Andy Weir'],
    isbn13: '9780593135211',
    pageCount: 496,
    year: 2021,
    coverUrl: apple('Publication211/v4/13/fb/63/13fb6355-fce2-0e4b-08b7-48452037759a/9780593135211.d.jpg'),
  }),
  tuesdaysWithMorrie: book('tuesdays-with-morrie', {
    title: 'Tuesdays with Morrie',
    authors: ['Mitch Albom'],
    isbn13: '9780307414090',
    pageCount: 224,
    year: 2007,
    coverUrl: apple('Publication122/v4/ed/e4/63/ede463a3-a899-9d31-ce86-98816dcb7181/9780307414090.d.jpg'),
  }),
  roadsidePicnic: book('roadside-picnic', {
    title: 'Roadside Picnic',
    authors: ['Arkady Strugatsky', 'Boris Strugatsky'],
    isbn13: '9781473208735',
    pageCount: 209,
    year: 2012,
    coverUrl: apple('Publication6/v4/02/7c/aa/027caae8-d826-f17d-30a3-1e75d5bfd187/9781473208735.jpg'),
  }),
  drBloodmoney: book('dr-bloodmoney', {
    title: 'Dr. Bloodmoney',
    authors: ['Philip K. Dick'],
    isbn13: '9780547840482',
    pageCount: 304,
    year: 2012,
    coverUrl: apple('Publication126/v4/60/17/9f/60179fef-f510-c89c-069d-f991996cf563/9780547840482.jpg'),
  }),
  shadowsUponTime: book('shadows-upon-time', {
    title: 'Shadows Upon Time',
    authors: ['Christopher Ruocchio'],
    isbn13: '9780756420017',
    pageCount: 928,
    year: 2025,
    coverUrl: apple('Publication211/v4/f5/9a/55/f59a55c6-e662-8159-26bb-0d8d224def97/9780756420017.d.jpg'),
  }),
  fallOfHyperion: book('fall-of-hyperion', {
    title: 'The Fall of Hyperion',
    authors: ['Dan Simmons'],
    isbn13: '9780307781895',
    pageCount: 528,
    year: 2011,
    coverUrl: apple('Publication211/v4/23/5e/19/235e19d5-cd0d-6b70-47c1-a08d232f0f7f/9780307781895.d.jpg'),
  }),
  ubik: book('ubik', {
    title: 'Ubik',
    authors: ['Philip K. Dick'],
    isbn13: '9780547728247',
    pageCount: 224,
    year: 2012,
    coverUrl: apple('Publication211/v4/d8/83/55/d8835508-3e61-54ec-27e0-b6b4d0c86a76/9780547728247.jpg'),
  }),
  stoner: book('stoner', {
    title: 'Stoner',
    authors: ['John Williams'],
    isbn13: '9781590173930',
    pageCount: 288,
    year: 2010,
    coverUrl: apple('Publication125/v4/bf/1f/bc/bf1fbcda-11b3-4cee-2909-1104ebe422b6/9781590173930.jpg'),
  }),
  flowersForAlgernon: book('flowers-for-algernon', {
    title: 'Flowers for Algernon',
    authors: ['Daniel Keyes'],
    isbn13: '9780547539638',
    pageCount: 304,
    year: 2007,
    coverUrl: apple('Publication122/v4/b4/b3/d5/b4b3d5b1-0dd6-abf5-7856-965e628b9fc1/9780547539638.jpg'),
  }),
  hyperion: book('hyperion', {
    title: 'Hyperion',
    authors: ['Dan Simmons'],
    isbn13: '9780307781888',
    pageCount: 496,
    year: 2011,
    coverUrl: apple('Publication211/v4/8b/c8/4a/8bc84a3e-bd3e-cabd-f5e2-a8739f9cad91/9780307781888.d.jpg'),
  }),
  titusGroan: book('titus-groan', {
    title: 'Titus Groan',
    authors: ['Mervyn Peake'],
    isbn13: '9781468301021',
    pageCount: 338,
    year: 2007,
    coverUrl: apple('Publication221/v4/68/a4/27/68a42789-85bc-1722-e189-39c761b494b2/1058359496.jpg'),
  }),
  galacticPotHealer: book('galactic-pot-healer', {
    title: 'Galactic Pot-Healer',
    authors: ['Philip K. Dick'],
    isbn13: '9780547999548',
    pageCount: 192,
    year: 2013,
    coverUrl: apple('Publication116/v4/1c/df/f2/1cdff257-1ca4-1172-bfb2-95442f832c10/9780547999548.jpg'),
  }),
  graceOfKings: book('grace-of-kings', {
    title: 'The Grace of Kings',
    authors: ['Ken Liu'],
    isbn13: '9781481424295',
    pageCount: 640,
    year: 2015,
    coverUrl: apple('Publication221/v4/1c/44/31/1c443129-5611-cb10-4e3d-2011fa0ac138/9781481424295.jpg'),
  }),
  useOfWeapons: book('use-of-weapons', {
    title: 'Use of Weapons',
    authors: ['Iain M. Banks'],
    isbn13: '9780316068796',
    pageCount: 512,
    year: 2008,
    coverUrl: apple('Publication113/v4/b1/c4/35/b1c4350e-2063-d273-2231-853bff00db6e/9780316068796.jpg'),
  }),
  antimemetics: book('antimemetics', {
    title: 'There Is No Antimemetics Division',
    authors: ['qntm'],
    isbn13: '9780593983768',
    pageCount: 288,
    year: 2025,
    coverUrl: apple('Publication221/v4/c8/bf/b3/c8bfb35c-53b3-7373-ad0e-561c68761d74/9780593983768.d.jpg'),
  }),
  considerPhlebas: book('consider-phlebas', {
    title: 'Consider Phlebas',
    authors: ['Iain M. Banks'],
    isbn13: '9780316095839',
    pageCount: 544,
    year: 2009,
    coverUrl: apple('Publication128/v4/fb/d2/7f/fbd27fff-a426-6300-05a0-421b5653c9c1/9780316095839.jpg'),
  }),
  willOfTheMany: book('will-of-the-many', {
    title: 'The Will of the Many',
    authors: ['James Islington'],
    isbn13: '9781982141196',
    pageCount: 640,
    year: 2023,
    coverUrl: apple('Publication221/v4/9c/01/0c/9c010cd4-0857-1ddc-a5aa-416df2b5d7a8/9781982141196.jpg'),
  }),
  /** Typed in by hand: no cover, so every direction draws its Placeholder cover. */
  gartenhaus: book('gartenhaus', {
    title: 'Der Gartenhaus-Sommer',
    authors: ['Hanna Brandt'],
    pageCount: 212,
    source: 'manual',
  }),
} satisfies Record<string, Book>

/** Not in the Library: the Book the "book-new" and "add-sheet" frames show. */
const leftHandOfDarkness = book('left-hand-of-darkness', {
  title: 'The Left Hand of Darkness',
  authors: ['Ursula K. Le Guin'],
  isbn13: '9781101665398',
  pageCount: 336,
  year: 1969,
  publisher: 'Ace',
  description:
    'A lone human ambassador is sent to the icebound planet of Winter, a world without sexual prejudice, where the inhabitants’ gender is fluid. His goal is to facilitate Winter’s inclusion in a growing intergalactic civilization.',
  coverUrl: apple('Publication211/v4/33/13/9c/33139cdd-1a27-94a4-1d8e-29c3bbf39b38/9781101665398.d.jpg'),
  source: 'apple',
})

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

let sessionCount = 0
function session(fields: Partial<ReadingSession>): ReadingSession {
  sessionCount += 1
  return {
    id: `s${sessionCount}`,
    startedOn: null,
    endedOn: null,
    outcome: null,
    rating: null,
    review: null,
    abandonReason: null,
    ...fields,
  }
}

const read = (startedOn: string, endedOn: string, rating: number | null = null, review: string | null = null) =>
  session({ startedOn, endedOn, outcome: 'finished', rating, review })

function entry(b: Book, addedOn: string, sessions: ReadingSession[] = []): LibraryEntry {
  return { id: b.id, book: b, status: statusOf(sessions), addedOn, sessions }
}

/** Ratings are the real ones, in quarters (17 = 4.25 stars). */
const library: LibraryEntry[] = [
  // Currently reading
  entry(books.carpetMakers, '2026-05-26', [session({ startedOn: '2026-05-25' })]),
  entry(books.ruin, '2026-02-01', [session({ startedOn: '2026-02-04' })]),

  // Finished, newest end date first. The newest is not rated yet (real).
  entry(books.flowMyTears, '2026-03-28', [read('2026-09-25', '2026-10-01')]),
  // Abandoned (invented): Finished status, shown under *Not finished*.
  entry(books.titusGroan, '2026-05-18', [
    session({
      startedOn: '2026-08-20',
      endedOn: '2026-09-12',
      outcome: 'abandoned',
      abandonReason: 'Beautiful sentences, but nothing moves. Maybe in winter.',
    }),
  ]),
  entry(books.wordForWorld, '2026-03-28', [read('2026-05-06', '2026-05-20', 17)]),
  // The re-read: a first read in 2019 (invented) and the real 2026 one.
  entry(books.dune, '2019-06-30', [
    read(
      '2019-07-03',
      '2019-08-11',
      19,
      'Read most of it on a train through the Alps. The ecology hooked me more than the prophecy.',
    ),
    read(
      '2026-04-12',
      '2026-05-17',
      16,
      'Slower the second time, and I noticed how much of it is politics. Still the best world-building I know.',
    ),
  ]),
  entry(books.projectHailMary, '2026-03-14', [
    read('2026-03-16', '2026-04-12', 18, 'Pure fun. Rocky is the best character of the year.'),
  ]),
  entry(books.tuesdaysWithMorrie, '2026-03-12', [read('2026-03-12', '2026-03-14', 20)]),
  entry(books.roadsidePicnic, '2026-02-20', [read('2026-02-22', '2026-02-25', 17)]),
  entry(books.drBloodmoney, '2026-02-02', [read('2026-02-04', '2026-02-16', 16)]),
  entry(books.shadowsUponTime, '2025-11-20', [read('2025-11-24', '2026-01-31', 15)]),
  entry(books.stoner, '2025-12-05', [
    read('2025-12-09', '2025-12-28', 20, 'Quiet, sad and perfect. A whole life in 280 pages.'),
  ]),
  entry(books.flowersForAlgernon, '2025-12-10', [read('2025-12-12', '2025-12-24', 20)]),
  entry(books.ubik, '2025-05-01', [read('2025-05-05', '2025-05-09', 20)]),
  entry(books.fallOfHyperion, '2025-01-12', [read('2025-01-16', '2025-02-11', 20)]),
  entry(books.hyperion, '2024-12-20', [read('2024-12-28', '2025-01-12', 20)]),

  // Want to read, newest first
  entry(books.galacticPotHealer, '2026-09-30'),
  entry(books.graceOfKings, '2026-06-08'),
  entry(books.useOfWeapons, '2026-06-06'),
  entry(books.antimemetics, '2026-06-05'),
  entry(books.considerPhlebas, '2026-05-23'),
  entry(books.gartenhaus, '2026-04-30'),
  entry(books.willOfTheMany, '2026-03-28'),
]

const byId = new Map(library.map((e) => [e.id, e]))

function get(id: string): LibraryEntry {
  const found = byId.get(id)
  if (!found) throw new Error(`proto data: no entry "${id}"`)
  return found
}

const collections: Collection[] = [
  {
    id: 'favourites',
    name: 'Favourites',
    entryIds: ['stoner', 'flowers-for-algernon', 'hyperion', 'dune', 'tuesdays-with-morrie', 'project-hail-mary'],
  },
  {
    id: 'sci-fi',
    name: 'Sci-fi',
    entryIds: [
      'project-hail-mary',
      'roadside-picnic',
      'word-for-world',
      'hyperion',
      'carpet-makers',
      'dune',
      'fall-of-hyperion',
      'use-of-weapons',
      'consider-phlebas',
      'antimemetics',
    ],
  },
  { id: 'to-gift', name: 'To gift', entryIds: ['tuesdays-with-morrie', 'project-hail-mary', 'stoner'] },
]

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const searchHits: Omit<SearchResult, 'coverColors'>[] = [
  // Own Catalogue first: one in the Library, one not.
  {
    id: 'r-word-for-world',
    pageCount: 192,
    title: 'The Word for World Is Forest',
    authors: ['Ursula K. Le Guin'],
    year: 2010,
    coverUrl: books.wordForWorld.coverUrl,
    source: 'catalogue',
    isbn13: '9781429983549',
    libraryStatus: 'finished',
    otherEdition: false,
  },
  {
    id: 'r-dispossessed',
    pageCount: 416,
    title: 'The Dispossessed',
    authors: ['Ursula K. Le Guin'],
    year: 2024,
    coverUrl: apple('Publication221/v4/6b/25/20/6b25209d-eb85-58fb-76cc-5e10da5604fa/9780063445796.jpg'),
    source: 'catalogue',
    isbn13: '9780063445796',
    libraryStatus: null,
    otherEdition: false,
  },
  // Apple Books
  {
    id: 'r-left-hand',
    pageCount: leftHandOfDarkness.pageCount,
    title: leftHandOfDarkness.title,
    authors: leftHandOfDarkness.authors,
    year: leftHandOfDarkness.year,
    coverUrl: leftHandOfDarkness.coverUrl,
    source: 'apple',
    isbn13: leftHandOfDarkness.isbn13,
    libraryStatus: null,
    otherEdition: false,
  },
  {
    id: 'r-wizard-of-earthsea',
    pageCount: 208,
    title: 'A Wizard of Earthsea',
    authors: ['Ursula K. Le Guin'],
    year: 2012,
    coverUrl: apple('Publication126/v4/e6/b4/61/e6b4611c-6763-ed18-fbef-aa3842472ae0/9780544084377.jpg'),
    source: 'apple',
    isbn13: '9780544084377',
    libraryStatus: null,
    otherEdition: false,
  },
  {
    id: 'r-lathe-of-heaven',
    pageCount: 192,
    title: 'The Lathe of Heaven',
    authors: ['Ursula K. Le Guin'],
    year: 2022,
    coverUrl: apple('Publication126/v4/5c/c8/fc/5cc8fc3b-6c10-9f41-ce1b-721159fa2d74/9781668014967.jpg'),
    source: 'apple',
    isbn13: '9781668014967',
    libraryStatus: null,
    otherEdition: false,
  },
  // OpenLibrary: last to arrive, cover from covers.openlibrary.org.
  {
    id: 'r-always-coming-home',
    pageCount: 525,
    title: 'Always Coming Home',
    authors: ['Ursula K. Le Guin'],
    year: 1985,
    coverUrl: 'https://covers.openlibrary.org/b/id/6938605-L.jpg',
    source: 'openlibrary',
    isbn13: null,
    libraryStatus: null,
    otherEdition: false,
  },
]

const searchResults: SearchResult[] = searchHits.map((hit) => ({ ...hit, coverColors: colorsFor(hit.coverUrl) }))

// ---------------------------------------------------------------------------
// The sample, as screens see it
// ---------------------------------------------------------------------------

const reading = library.filter((e) => e.status === 'reading')
const wantToRead = library.filter((e) => e.status === 'want_to_read')
const finished = library.filter((e) => e.status === 'finished')

export const sample = {
  today,

  /** The signed-in Member. */
  member: { name: 'Fabian Kirchhoff', firstName: 'Fabian', initials: 'FK', email: 'fabian@example.com' },

  /** Every Library entry (23), grouped by Status, newest first inside each. */
  library,
  /** Look up an entry by id (= the Book's id). */
  entry: get,

  /** *Currently reading* (2), newest start first. */
  reading,
  /** *Want to read* (7), newest added first. */
  wantToRead,
  /** *Finished* (14, including the abandoned one), newest end date first. */
  finished,
  /** The *Not finished* filter: finished entries whose latest session was abandoned (1). */
  notFinished: finished.filter((e) => latestSession(e)?.outcome === 'abandoned'),
  /** Home's *Up next* row: the first few *Want to read* entries. */
  upNext: wantToRead.slice(0, 5),
  /** Home's counter. The real number from Fabian's history, not a count of this sample. */
  readInYear: { year: 2026, count: 13 },

  /** Three Collections; `collectionEntries` resolves one to its entries in order. */
  collections,
  collectionEntries: (collection: Collection) => collection.entryIds.map(get),
  /** The first `n` cover URLs of a collection, for mosaics (null = Placeholder cover). */
  collectionCovers: (collection: Collection, n = 4) =>
    collection.entryIds.slice(0, n).map((id) => get(id).book.coverUrl),
  /** The Collections an entry is in (book detail). */
  collectionsOf: (entry: LibraryEntry) => collections.filter((c) => c.entryIds.includes(entry.id)),

  /** Search for "le guin": the frames `search-typing`, `search-results`, `search-empty`. */
  search: {
    /** Typed so far in `search-typing`. */
    typingQuery: 'le gu',
    /** Catalogue and Apple are in; OpenLibrary is still loading in `search-typing`. */
    typingResults: searchResults.filter((r) => r.source !== 'openlibrary'),
    typingLoading: ['openlibrary'] as SearchSource[],
    /** The full query in `search-results`. */
    query: 'le guin',
    /** All three sources merged: catalogue, then Apple, then OpenLibrary. */
    results: searchResults,
    /** The query in `search-empty`, which offers "Add manually". */
    emptyQuery: 'gartenhaus sommer brandt',
  },

  /** `book-new` and `add-sheet`: a Book from search, not in the Library. */
  newBook: leftHandOfDarkness,
  /** `add-sheet`: the Member picked *Currently reading*, start date today. */
  addDraft: {
    status: 'reading' as Status,
    statuses: [
      { value: 'want_to_read' as Status, label: 'Want to read' },
      { value: 'reading' as Status, label: 'Currently reading' },
      { value: 'finished' as Status, label: 'Finished' },
    ],
    startedOn: today,
    endedOn: null as string | null,
  },

  /** `book-reading` and `finish-sheet`: the open session of The Carpet Makers. */
  readingEntry: get('carpet-makers'),
  /** `finish-sheet`: rating mid-drag at 3.75 stars, review half-typed. */
  finishDraft: {
    endedOn: today,
    rating: 15,
    dragging: true,
    review: 'Strange and patient. Every chapter a new knot in the same carpet, and then the whole picture',
  },

  /** `book-finished`: Dune, read twice, two ratings, two reviews, in two Collections. */
  finishedEntry: get('dune'),

  /** `library-finished`: Status segment Finished with the *Not finished* filter chip available. */
  libraryFilters: [
    { value: 'all', label: 'All' },
    { value: 'not_finished', label: 'Not finished' },
  ],

  /** `collection`: the Sci-fi collection. */
  openCollection: collections[1]!,

  /** `manual-book`: the form half filled; the preview uses a Placeholder cover. */
  manualDraft: { title: 'Der Gartenhaus-Sommer', authors: ['Hanna Brandt'], isbn: '', pageCount: '212' },
  /** A Manual book already in the Library (Want to read), no cover. */
  manualBook: books.gartenhaus,
}

export type Sample = typeof sample
