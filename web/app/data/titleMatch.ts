/**
 * Whether two titles name one book, loosely: the shared rule behind every title-based search of the app (the
 * Goodreads cover search in `supabase/functions/goodreads-rating`, the import's `isSameWork`,
 * data/import/editions.ts). Pure, and no imports of its own: Deno (the function imports this file), Node and the
 * browser all run it, like `dnbRecord.ts`.
 *
 * Search engines word a title differently than a file does: a credit appended ("A Jingle Bell Mingle by Julie
 * Murphy and Sierra Simone"), a word more or less ("A Fall to Forgive" / "A Fall to Forgive You"), a series aside
 * ("Title (Series, #2)"), `&` for "and", accents, a volume mark. `fuzzyTitleMatch` accepts those, and only those:
 *
 *  - never without the author: it takes `authorMatches`, the caller's verdict on the surname, and answers false
 *    when that is false (a title alone is too weak);
 *  - never another volume: two named volumes must be equal, and an unnamed side only stands for the first
 *    ("Series" is the first book's title as often as not, never the third's);
 *  - never a book about the book (summary, study guide, workbook, journal…);
 *  - never a book that merely begins like it, or is about it: the shorter title must say something (three
 *    words), and what the longer one adds is one word after it (not a number or a companion's word) or a little word
 *    before it ("The"); "World of Ember of Salt" is not "Ember of Salt".
 *
 * Of the forms a title is known by (whole; before a dash or colon; after it) the whole of the one is compared
 * with the whole of the other, and a part of the one only with the whole of the other: two volumes that share a
 * series prefix ("Harbour Lights - Cold Water" / "Harbour Lights - Warm Sand") never meet through it.
 */

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eins: '1', zwei: '2', drei: '3', vier: '4', fünf: '5', sechs: '6', sieben: '7', acht: '8', neun: '9', zehn: '10',
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
}

/**
 * The volume a title names ("Heartstopper: Volume Three", "Band 2", "Book II", "Teil 4", "Tome 02"): its
 * number as digits, or null when the title names none. The work title drops what follows a
 * colon, so the volumes of one series share it; this is what tells them apart.
 */
export function volumeOf(title: string): string | null {
  const match = /\b(?:volume|vol|band|bd|teil|book|buch|part|tome)\.?\s*(\d{1,3}|[a-zäöü]+)\b/i.exec(title.replace(/#/g, ' '))
  if (!match) return null
  const word = match[1]!.toLowerCase()
  return /^\d+$/.test(word) ? String(Number(word)) : (NUMBER_WORDS[word] ?? null)
}

/** Two titles that name different volumes are not the same book, whatever else they share. */
export const sameVolume = (a: string, b: string): boolean => {
  const ours = volumeOf(a)
  const theirs = volumeOf(b)
  return !ours || !theirs || ours === theirs
}

/** A book about a book, sold under its title: a summary, a study guide, a workbook. */
export const COMPANION = /\b(?:summary|summaries|zusammenfassung|study guide|workbook|sparknotes|cliffsnotes|analysis of)\b/i

/** Lower case, accents gone, `&` as "and", punctuation and spaces collapsed to single spaces. */
export function normaliseTitle(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[łđøßæœ]/g, (c) => ({ ł: 'l', đ: 'd', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe' })[c]!)
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** A volume's mark inside a series title: "T01", "Tome 01", "Band 2", "Book 3", "Vol. 4", "#1". */
const VOLUME_MARK = /\bt(?=\d)\d{1,3}\b|\b(?:tome|band|bd|book|buch|teil|vol|volume|part|folge)\.?\s*(?:\d{1,3}|[ivx]{1,4})\b|#\s*\d{1,3}\b/gi

/** Where a series prefix ends or a subtitle begins: a dash between spaces, an en or em dash, a bar, or a colon. */
const SEPARATOR = /\s+-\s+|\s*[–—|:]\s*/

/** A credit a search result appends: " by Julie Murphy and Sierra Simone", " von …" (after at least two words). */
const CREDIT = /^(\S+(?:\s+\S+)+?)\s+(?:by|By|von|Von)\s+\p{Lu}.*$/u
/** What a title may end on without saying anything about the book: "A Novel", "Roman", "Illustrated Edition". */
const DESCRIPTOR = /[\s,:–—-]+(?:a novel|a romance|ein roman|novel|roman|illustrated edition|special edition|deluxe edition|collector'?s edition)$/i

/** Little words that do not tell books apart. */
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'der', 'die', 'das', 'den', 'dem', 'und', 'von', 'ein', 'eine', 'le', 'la', 'les', 'el', 'de'])
/** Words a companion volume adds to a book's title; the longer title never gets to add one. */
const COMPANION_WORDS = new Set([
  'summary', 'summaries', 'guide', 'workbook', 'journal', 'notebook', 'planner', 'companion', 'coloring', 'colouring', 'cookbook',
  'quiz', 'trivia', 'analysis', 'review', 'notes', 'calendar', 'boxed', 'set', 'collection', 'bundle', 'omnibus', 'anthology',
  'zusammenfassung', 'sparknotes', 'cliffsnotes',
])

type Parts = { whole: string[]; parts: string[][] }

/** The words of a title once the aside, the volume mark, the credit and the descriptor are gone; its whole, and its parts either side of a separator. */
function partsOf(title: string): Parts {
  const bare = title.replace(/\s*[([][^()[\]]*[)\]]/g, ' ').replace(VOLUME_MARK, ' ').replace(/\s+/g, ' ').trim()
  const clean = (text: string) => {
    return normaliseTitle(text.replace(CREDIT, '$1').replace(DESCRIPTOR, '')).split(' ').filter(Boolean)
  }
  const whole = clean(bare)
  const segments = bare.split(SEPARATOR).map((part) => part.trim()).filter(Boolean)
  const parts = segments.length > 1 ? segments.map(clean).filter((words) => words.length) : []
  return { whole, parts }
}

/** `short` sits at the start or the end of `long`, whole words, with nothing inside it changed; what `long` adds, and where. */
function atEdge(short: string[], long: string[]): { extra: string[]; at: 'end' | 'start' } | null {
  if (short.length > long.length) return null
  const head = long.slice(0, short.length)
  if (head.every((word, i) => word === short[i])) return { extra: long.slice(short.length), at: 'end' }
  const tail = long.slice(long.length - short.length)
  if (tail.every((word, i) => word === short[i])) return { extra: long.slice(0, long.length - short.length), at: 'start' }
  return null
}

/** The telling words: the words that are not little ones. */
const telling = (words: string[]) => words.filter((word) => !STOP.has(word))

/** Whether two word lists are one title, close: equal, one the other plus one word after it or a little word before it, or one word apart. */
function close(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false
  if (a.length === b.length && a.every((word, i) => word === b[i])) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  // The shorter title must say something: three words (counting the little ones) and a telling one among them.
  if (short.length < 3 || !telling(short).length) return false
  const edge = atEdge(short, long)
  if (edge) {
    const { extra, at } = edge
    // What the longer one adds: one word after the title ("A Fall to Forgive You"; not a number, a roman numeral or a
    // companion's word), or a little word before it ("The Girl in the Winter Song"). Never a word before the title ("World of
    // Ember of Salt", "The Art of …" are books about it) and never more.
    if (!extra.length) return false
    if (at === 'start') return extra.length <= 2 && extra.every((word) => STOP.has(word))
    return extra.length === 1 && !/^(?:\d+|ii|iii|iv|vi|vii|viii|ix|x)$/.test(extra[0]!) && !COMPANION_WORDS.has(extra[0]!)
  }
  // Else a high overlap: the same telling words but one (a little word more or less never counts).
  const ours = telling(short)
  const theirs = telling(long)
  if (ours.length < 3) return false
  const shared = ours.filter((word) => theirs.includes(word)).length
  const apart = ours.length - shared + (theirs.length - shared)
  return shared >= 3 && apart <= 1
}

/**
 * Whether two titles may be one book as far as volume and kind go, whatever else they share: both name the same volume,
 * or one names none and the other the first (the series' name is its first book's title as often as not, never the
 * third's); and neither is a summary, study guide or workbook the other is not. The rule's two guards, for a caller
 * that compares titles another way (the Goodreads function's exact forms).
 */
export function sameBookKind(wanted: string, found: string): boolean {
  if (COMPANION.test(found) !== COMPANION.test(wanted)) return false
  const theirs = volumeOf(found)
  const ours = volumeOf(wanted)
  return ours && theirs ? ours === theirs : Number(ours ?? theirs ?? 1) <= 1
}

/**
 * Whether a found title is the wanted one, loosely (the rule above). `authorMatches`: the caller found the wanted
 * author's surname among the found book's authors; without it the answer is always false. Pure.
 */
export function fuzzyTitleMatch(wanted: string, found: string, authorMatches: boolean): boolean {
  if (!authorMatches || !sameBookKind(wanted, found)) return false
  const a = partsOf(wanted)
  const b = partsOf(found)
  if (close(a.whole, b.whole)) return true
  // A part of the one (its series prefix or subtitle gone) is the whole of the other, never part against part.
  return a.parts.some((part) => close(part, b.whole)) || b.parts.some((part) => close(a.whole, part))
}
