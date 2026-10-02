/** Authors as one line: "Ursula K. Le Guin", "Terry Pratchett & Neil Gaiman", "Ann Leckie et al.". */
export function formatAuthors(authors: readonly string[], etAl: string): string {
  if (authors.length <= 1) return authors[0] ?? ''
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`
  return `${authors[0]} ${etAl}`
}
