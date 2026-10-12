/**
 * The words of a reading page's link preview and picture, in the two languages the app speaks (German group
 * B of #257). The preview is made by a crawler and the picture by an edge function, neither of which has the
 * app's i18n, so the lines live here as plain functions, with no imports: the Pages Function that writes the
 * preview's tags (web/functions/r/[[path]].js) and the `reading-page-og` edge function (Deno) both import this
 * file, and the tests do too. Nothing here is ever concatenated by a caller: a sentence is one function.
 *
 * Which language: the link says. The app adds `?lang=de` to the address of a page or a card when its member uses
 * German (data/readingPage.ts), because a preview is made once, for whoever the link is sent to, and the only
 * thing that knows the sender's language at that moment is the sender's app. No `lang`, or any other value, is
 * English, so every link made before this still previews as it did. German follows docs/i18n/german-glossary.md
 * (Leseseite, Regal, Gelesen) and carries no gender sign.
 */
export type PreviewLang = 'en' | 'de'

/** What a `lang` query value means: `de` is German, anything else (and nothing) is English. */
export const previewLang = (raw: string | null | undefined): PreviewLang => (raw === 'de' ? 'de' : 'en')

export type PreviewText = {
  /** "Ada’s reading", "A reading page" (no name). */
  pageTitle: (name: string) => string
  /** "A Book by an author"; `author` is null when it has none. */
  bookByAuthor: (title: string, author: string | null) => string
  aBook: string
  notFoundTitle: string
  notFoundText: string
  /** The picture's small label above the title. */
  readingPageLabel: string
  outsideCatalogue: string
  readingNow: (title: string) => string
  readingOutside: string
  booksInYear: (count: number, year: number) => string
  booksFinished: (count: number) => string
  /** The line when a page shows nothing else: with her name for a link, without for the picture. */
  booksNameHasRead: (name: string) => string
  shelfOfBooks: string
  shelfToLookAt: string
  /** "4½ stars" from the value as the preview writes it ("4½"). */
  starsText: (value: string) => string
  /** The card's sentence about a Book: her Rating, or where it stands. `name` is "She" / "Sie" without one. */
  rated: (name: string, stars: string) => string
  isReading: (name: string) => string
  wantsToRead: (name: string) => string
  finished: (name: string) => string
  anonymousName: string
  /** The status as a label on the card's picture. */
  statusReading: string
  statusWant: string
  statusFinished: string
}

const EN: PreviewText = {
  pageTitle: (name) => (name ? `${name}’s reading` : 'A reading page'),
  bookByAuthor: (title, author) => (author ? `${title} by ${author}` : title),
  aBook: 'A book',
  notFoundTitle: 'Not found',
  notFoundText: 'This reading page is not here any more.',
  readingPageLabel: 'Reading page',
  outsideCatalogue: 'Outside the catalogue',
  readingNow: (title) => `Reading ${title}`,
  readingOutside: 'Reading a book outside the catalogue',
  booksInYear: (count, year) => `${count} ${count === 1 ? 'book' : 'books'} in ${year}`,
  booksFinished: (count) => `${count} ${count === 1 ? 'book' : 'books'} finished`,
  booksNameHasRead: (name) => `Books ${name} has read`,
  shelfOfBooks: 'A shelf of books',
  shelfToLookAt: 'A shelf to look at',
  starsText: (value) => `${value} ${value === '1' ? 'star' : 'stars'}`,
  rated: (name, stars) => `${name} rated it ${stars}`,
  isReading: (name) => `${name} is reading it`,
  wantsToRead: (name) => `${name} wants to read it`,
  finished: (name) => `${name} finished it`,
  anonymousName: 'She',
  statusReading: 'Reading now',
  statusWant: 'Wants to read',
  statusFinished: 'Finished',
}

const DE: PreviewText = {
  pageTitle: (name) => (name ? `${name} liest` : 'Eine Leseseite'),
  bookByAuthor: (title, author) => (author ? `${title} von ${author}` : title),
  aBook: 'Ein Buch',
  notFoundTitle: 'Nicht gefunden',
  notFoundText: 'Diese Leseseite gibt es nicht mehr.',
  readingPageLabel: 'Leseseite',
  outsideCatalogue: 'Außerhalb des Katalogs',
  readingNow: (title) => `Liest ${title}`,
  readingOutside: 'Liest ein Buch außerhalb des Katalogs',
  booksInYear: (count, year) => `${count} ${count === 1 ? 'Buch' : 'Bücher'} in ${year}`,
  booksFinished: (count) => `${count} ${count === 1 ? 'Buch' : 'Bücher'} gelesen`,
  booksNameHasRead: (name) => `Bücher, die ${name} gelesen hat`,
  shelfOfBooks: 'Ein Regal voller Bücher',
  shelfToLookAt: 'Ein Regal zum Stöbern',
  // Dative, because the sentence says "mit 4½ Sternen bewertet".
  starsText: (value) => `${value} ${value === '1' ? 'Stern' : 'Sternen'}`,
  rated: (name, stars) => `${name} hat es mit ${stars} bewertet`,
  isReading: (name) => `${name} liest es gerade`,
  wantsToRead: (name) => `${name} möchte es lesen`,
  finished: (name) => `${name} hat es gelesen`,
  anonymousName: 'Sie',
  statusReading: 'Liest gerade',
  statusWant: 'Möchte es lesen',
  statusFinished: 'Gelesen',
}

export const previewText = (lang: PreviewLang | string | null | undefined): PreviewText => (previewLang(lang) === 'de' ? DE : EN)
