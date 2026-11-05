/**
 * Potential buddy reads on a friend's profile (docs/parity.md, "Potential buddy reads"): Books she and this friend could read together,
 * worked out on her phone from what she may already see (her own Library, her active buddy reads, and what the friend's profile
 * shows her under the friend's switches). Nothing is asked of the database for it, so nothing can show her more of the friend than her
 * page does: a list the friend hides arrives as `null` and contributes nothing. Pure: no Vue, no i18n, no Supabase; the screen words
 * the reasons, and a native port copies it 1:1.
 *
 * Ranked, strongest first, at most `SUGGESTIONS_MAX`:
 *  1. `both_want`: on both want-to-read lists;
 *  2. `you_reading` / `they_reading`: on one's want-to-read while the other is reading it;
 *  3. `author_yours` / `author_theirs`: a Book on one side's want-to-read or reading, by an author the other one has finished (hers
 *     from her Library, the friend's from the finished Books her profile shows). Authors only: the friend's genres are not on her
 *     profile, so a genre match would need a new reading of her.
 * Within a rank, the order of the lists (newest first). There is no rank for a shared Collection: a Collection is its owner's alone
 * (`private.social_*` never lets one out), so nothing of the friend's could be compared.
 *
 * Never suggested: a Book either has finished or put down (as far as the friend shows it), one of her active buddy reads (or an
 * invitation she has waiting), a Manual book (it is not in the Catalogue, so it cannot be shared) or one the server check could not confirm.
 * The same Book in another edition counts as the same (id, else title and first author).
 */

/** The most covers the section draws. */
export const SUGGESTIONS_MAX = 12

/** A Book as far as this needs it: both the Library's Book and a social answer's fit. */
export type SuggestionBook = {
  id: string
  title: string
  authors: readonly string[]
  year?: number | null
  coverUrl?: string | null
  coverThumbhash?: string | null
  coverColors?: { dominant: string; secondary: string } | null
  coverKey?: string | null
  coverWidths?: number[] | null
  manual?: boolean
  unverified?: boolean
}

/** Why a Book is suggested, as a code (the screen has the words); `author`: the name as the Book credits it. */
export type SuggestionReason =
  | { kind: 'both_want' }
  | { kind: 'you_reading' }
  | { kind: 'they_reading' }
  | { kind: 'author_yours'; author: string }
  | { kind: 'author_theirs'; author: string }

export type Suggestion = { book: SuggestionBook; reason: SuggestionReason }

/** What the friend's profile shows of her reading: `null` for a list her switches hide. */
export type FriendShown = {
  want: readonly SuggestionBook[] | null
  reading: readonly SuggestionBook[] | null
  /** The Books she finished or put down that the profile (or her record) shows. `abandoned`: put down, not finished (no taste in it). */
  done: readonly { book: SuggestionBook; abandoned?: boolean }[] | null
}

/** Her own Library, each list newest first; `finished` holds the put-down ones too (`abandoned`). */
export type MineShown = {
  want: readonly SuggestionBook[]
  reading: readonly SuggestionBook[]
  finished: readonly { book: SuggestionBook; abandoned?: boolean }[]
}

export type SuggestionInput = {
  mine: MineShown
  friend: FriendShown
  /** The Books of her active buddy reads and of the invitations she has waiting. */
  together: readonly Pick<SuggestionBook, 'id' | 'title' | 'authors'>[]
}

/** Whether the friend's profile shows anything the suggestions could use (nothing is read or asked while it does not). */
export function friendShowsAnything(friend: FriendShown): boolean {
  return friend.want !== null || friend.reading !== null || friend.done !== null
}

const MARKS = /[\u0300-\u036f]/g
const NOT_WORDS = /[^\p{L}\p{N}]+/gu

/** A name or title with case, accents and punctuation gone. */
function plain(text: string): string {
  return text.normalize('NFKD').replace(MARKS, '').toLowerCase().replace(NOT_WORDS, ' ').trim()
}

/** An author as one key: the words of the name in any order, so "Clarke, Susanna" is "Susanna Clarke". */
export function authorKey(name: string): string {
  return plain(name).split(' ').filter(Boolean).sort().join(' ')
}

/** The same Book in another edition: its title and first author, plain. Empty (no match) without a title. */
export function workKey(book: Pick<SuggestionBook, 'title' | 'authors'>): string {
  const title = plain(book.title)
  if (!title) return ''
  return `${title}|${authorKey(book.authors[0] ?? '')}`
}

/** A set of Books to ask "is this one of them" of, by id and by `workKey`. */
function setOf(books: readonly Pick<SuggestionBook, 'id' | 'title' | 'authors'>[]) {
  const ids = new Set<string>()
  const keys = new Set<string>()
  for (const book of books) {
    ids.add(book.id)
    const key = workKey(book)
    if (key) keys.add(key)
  }
  return {
    has(book: Pick<SuggestionBook, 'id' | 'title' | 'authors'>): boolean {
      if (ids.has(book.id)) return true
      const key = workKey(book)
      return key !== '' && keys.has(key)
    },
  }
}

/** The Books she and the friend could read together: see the module's header. `[]` when there is nothing, and then no section. */
export function suggestBuddyReads({ mine, friend, together }: SuggestionInput): Suggestion[] {
  const unusable = (book: SuggestionBook) => Boolean(book.manual || book.unverified) || !book.title.trim()
  const doneByThem = setOf((friend.done ?? []).map((d) => d.book))
  const doneByMe = setOf(mine.finished.map((d) => d.book))
  const inReads = setOf(together)
  const excluded = (book: SuggestionBook) => unusable(book) || inReads.has(book) || doneByMe.has(book) || doneByThem.has(book)

  const myWant = setOf(mine.want)
  const myReading = setOf(mine.reading)
  const myLibrary = setOf([...mine.want, ...mine.reading, ...mine.finished.map((d) => d.book)])
  const theirWant = setOf(friend.want ?? [])
  const theirReading = setOf(friend.reading ?? [])

  // The authors each has finished: the taste (a put-down Book says nothing of it). Hers from her Library, the friend's from what her profile shows.
  const myAuthors = authorsOf(mine.finished.filter((d) => !d.abandoned).map((d) => d.book))
  const theirAuthors = authorsOf((friend.done ?? []).filter((d) => !d.abandoned).map((d) => d.book))

  const out: Suggestion[] = []
  const seen = new Set<string>()
  /** Adds a Book once (however many lists name it), unless it is excluded; the first reason, which is the strongest, stays. */
  function add(book: SuggestionBook, reason: SuggestionReason) {
    if (excluded(book)) return
    const key = workKey(book)
    if (seen.has(book.id) || (key && seen.has(key))) return
    seen.add(book.id)
    if (key) seen.add(key)
    out.push({ book, reason })
  }
  /** Her own copy of a Book she has (her edition, her cover), else the friend's. */
  const hers = (list: readonly SuggestionBook[], book: SuggestionBook) => list.find((b) => b.id === book.id || (workKey(b) !== '' && workKey(b) === workKey(book))) ?? book

  const theirWantList = friend.want ?? []
  const theirReadingList = friend.reading ?? []

  // 1. Both want it.
  for (const book of theirWantList) if (myWant.has(book)) add(hers(mine.want, book), { kind: 'both_want' })
  // 2. One wants it, the other is reading it.
  for (const book of theirWantList) if (myReading.has(book)) add(hers(mine.reading, book), { kind: 'you_reading' })
  for (const book of theirReadingList) if (myWant.has(book)) add(hers(mine.want, book), { kind: 'they_reading' })
  // 3. Taste: her Library's authors in what the friend wants or reads, the friend's finished authors in what she wants or reads.
  for (const book of [...theirWantList, ...theirReadingList]) {
    if (myLibrary.has(book)) continue
    const author = match(book, myAuthors)
    if (author) add(book, { kind: 'author_yours', author })
  }
  for (const book of [...mine.want, ...mine.reading]) {
    if (theirWant.has(book) || theirReading.has(book)) continue
    const author = match(book, theirAuthors)
    if (author) add(book, { kind: 'author_theirs', author })
  }

  return out.slice(0, SUGGESTIONS_MAX)
}

/** The authors of some Books by key, each as first credited. */
function authorsOf(books: readonly SuggestionBook[]): Map<string, string> {
  const authors = new Map<string, string>()
  for (const book of books) {
    for (const name of book.authors) {
      const key = authorKey(name)
      if (key && !authors.has(key)) authors.set(key, name)
    }
  }
  return authors
}

/** The name of the first author of the Book that is among `authors`, as that side credits it. */
function match(book: SuggestionBook, authors: Map<string, string>): string | null {
  for (const name of book.authors) {
    const known = authors.get(authorKey(name))
    if (known) return known
  }
  return null
}
