/** What every variant's chrome shows: the reader's place in words and figures. */
export interface ChromeInfo {
  title: string
  chapter: string | null
  /** 0–1 of the body. */
  fraction: number
  /** 0–1 of the current chapter (section). */
  chapterFraction: number
  /** The Book's page (of its page count) at the reader's place. */
  page: number
  pages: number
  minutesChapter: number
  minutesBook: number
  /** The page saved as progress, when the reader is behind it (it never moves back by itself). */
  behind: number | null
  atEnd: boolean
}

/** "12 min left in chapter", "Under a minute left", "1 h 5 min left in book". */
export function minutesLeft(minutes: number, where: 'chapter' | 'book'): string {
  const m = Math.round(minutes)
  if (m < 1) return `Under a minute left in ${where}`
  if (m < 60) return `${m} min left in ${where}`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return `${h} h${rest ? ` ${rest} min` : ''} left in ${where}`
}

/** What heads a page: the chapter, with the book's title where the chapter is only a number ("I"). */
export function runningHead(title: string, chapter: string | null): string {
  if (!chapter || chapter === title) return title
  return chapter.length <= 5 ? `${title} · ${chapter}` : chapter
}
