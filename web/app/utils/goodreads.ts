/**
 * A Book of the shelf's library file on Goodreads (#23): its page when the
 * file's id is a Goodreads id (numeric), else a search for its ISBN or its
 * title and author. What Regal's own link does; the shelf's Stack and row
 * show it as one of the details' actions.
 */
export function goodreadsUrl(book: { id: string; isbn13: string | null; title: string; author: string | null }): string {
  if (/^\d+$/.test(book.id)) return `https://www.goodreads.com/book/show/${book.id}`
  const query = book.isbn13 ?? [book.title, book.author].filter(Boolean).join(' ')
  return `https://www.goodreads.com/search?q=${encodeURIComponent(query)}`
}
