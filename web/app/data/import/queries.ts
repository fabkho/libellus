import type { SourceName } from '../merge'
import { normalize } from './readingTracker'
import type { ImportBook } from './rows'

/**
 * How the import asks the sources for a row's book by its title (issue #111,
 * the import-quality fix): a ladder of query strategies, tried in order until
 * one finds the row's work (`isSameWork`, data/import/editions.ts). The first is
 * what search asks (title and first author); the next ones drop what makes a
 * source miss a book it has: a subtitle or series prefix, the author's given
 * names or initials, umlauts a catalogue writes out ("Mueller"), the author
 * (a name the file spells differently), and the name's order. A strategy that
 * would ask nothing new says so (null) and is skipped.
 *
 * Each strategy names the sources worth its question: Apple's limit is spent
 * only on the questions that can change its answer; the Catalogue and Open
 * Library are asked every time. Pure: the asking is data/bookImport.ts.
 */

export type QueryRow = Pick<ImportBook, 'title' | 'authors'>

export type QueryStrategy = {
  name: 'titleAuthor' | 'mainTitleSurname' | 'spelledOut' | 'titleOnly' | 'authorSwapped'
  /** The question, or null when this strategy has nothing to add for the row. */
  query: (row: QueryRow) => string | null
  /** The sources asked (all when left out). */
  sources?: readonly SourceName[]
}

/** The sources that cost nothing to ask again: no per-address limit to spare. */
export const FREE_SOURCES: readonly SourceName[] = ['catalogue', 'openlibrary']

/** The title before a subtitle or after a series prefix's end is not looked at: "Satisfy Me: Wenn Liebe …" → "Satisfy Me". */
export function mainTitle(title: string): string {
  const bare = title.replace(/\s*[([][^()[\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim()
  return (bare.split(/\s*[:|–—]\s*|\s+-\s+/)[0] ?? bare).trim()
}

/** An author's name as words, surname last, as written ("Melville, Herman" → ["Herman", "Melville"]). */
function nameWords(author: string | undefined): string[] {
  const name = (author ?? '').trim()
  const ordered = /^[^,]+,\s*[^,]+$/.test(name) ? name.split(',').reverse().join(' ') : name
  return ordered.split(/\s+/).filter(Boolean)
}

/** Umlauts and ß written out, as an ASCII catalogue spells them. */
export function spelledOut(text: string): string {
  return text.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
}

const join = (...parts: (string | undefined | null)[]) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || null

/** Best first: the order the import asks in. */
export const QUERY_STRATEGIES: readonly QueryStrategy[] = [
  // What search asks: the title as the file has it (its Goodreads series already split off) and the first author.
  { name: 'titleAuthor', query: (row) => join(row.title, row.authors[0]) },
  // A subtitle or series prefix a source does not carry, and initials or given names it writes otherwise.
  { name: 'mainTitleSurname', query: (row) => join(mainTitle(row.title), nameWords(row.authors[0]).at(-1)) },
  // Umlauts written out ("Müller" as "Mueller"): only for a row that has some, and only where a catalogue may spell them so.
  {
    name: 'spelledOut',
    query: (row) => {
      const asked = join(mainTitle(row.title), nameWords(row.authors[0]).at(-1))
      return asked && spelledOut(asked) !== asked ? spelledOut(asked) : null
    },
    // Apple writes umlauts as they are: the ASCII spelling is for the catalogues that drop them.
    sources: FREE_SOURCES,
  },
  // The author as the file spells it may be what keeps the book from being found ("Austen", "Austin"): the title alone,
  // when it is telling enough to be asked by itself (two words, or one long one).
  {
    name: 'titleOnly',
    query: (row) => {
      const title = mainTitle(row.title)
      const words = normalize(title).split(' ').filter(Boolean)
      return words.length >= 2 || (words[0]?.length ?? 0) >= 8 ? title : null
    },
    // Not Apple: a title alone is a broad question there, and Apple's limit is the import's scarcest thing (measured:
    // with this question at Apple too, a 200-row lookup met Apple's refusals after about 250 searches).
    sources: FREE_SOURCES,
  },
  // Surname first: a catalogue that files authors "Melville, Herman" and matches the words in order.
  {
    name: 'authorSwapped',
    query: (row) => {
      const words = nameWords(row.authors[0])
      return words.length > 1 ? join(mainTitle(row.title), words.at(-1), ...words.slice(0, -1)) : null
    },
    sources: FREE_SOURCES,
  },
]

export type Question = { strategy: QueryStrategy['name']; query: string; sources?: readonly SourceName[] }

/**
 * The questions to ask about a row, in order, each once: a strategy whose
 * question is one asked already (case and spacing aside) is left out.
 */
export function questionsFor(row: QueryRow, strategies: readonly QueryStrategy[] = QUERY_STRATEGIES): Question[] {
  const asked = new Set<string>()
  const out: Question[] = []
  for (const strategy of strategies) {
    const query = strategy.query(row)
    if (!query) continue
    const key = query.toLowerCase().replace(/\s+/g, ' ')
    if (asked.has(key)) continue
    asked.add(key)
    out.push({ strategy: strategy.name, query, ...(strategy.sources ? { sources: strategy.sources } : {}) })
  }
  return out
}
