/**
 * What the reader's chrome shows (#131 phase 2): the place in words and
 * figures, the same for the printed page's capsule, the classic bars and the
 * scroll's bars. Framework-free; the words themselves come from the message
 * file in the components.
 */
export interface ChromeInfo {
  title: string
  chapter: string | null
  /** 0–1 of the book's body. */
  fraction: number
  /** 0–1 of the current chapter. */
  chapterFraction: number
  /** The Book's page at the reader's place, when the Book has a page count; else null (percent). */
  page: number | null
  pages: number | null
  minutesChapter: number
  minutesBook: number
  /** The progress saved, when the reader is clearly behind it (it never moves back by itself); its words. */
  behind: string | null
  atEnd: boolean
}

/** What heads the scroll's chapter: the chapter, with the book's title where it is only a number ("I"). */
export function runningHead(title: string, chapter: string | null): string {
  if (!chapter || chapter === title) return title
  return chapter.length <= 5 ? `${title} · ${chapter}` : chapter
}

/** Whole minutes, at least 0. */
export const minutes = (m: number) => Math.max(0, Math.round(m))

/** "min left" in words: `t` is the message function; over an hour the book's time is hours and minutes. */
export function timeLeft(t: (key: string, named?: Record<string, unknown>, plural?: number) => string, m: number, where: 'chapter' | 'book'): string {
  const whole = minutes(m)
  if (where === 'book' && whole >= 60) return t('reader.hoursBook', { hours: Math.floor(whole / 60), minutes: whole % 60 })
  return t(where === 'chapter' ? 'reader.minutesChapter' : 'reader.minutesBook', { count: whole }, whole)
}
