/**
 * Telling whether two titles or two names mean the same thing, across sources
 * that spell them differently ("The Dispossessed: An Ambiguous Utopia" and
 * "The Dispossessed", "Ursula  K. Le Guin" and "Ursula K. Le Guin",
 * "H.G. Wells" and "H. G. Wells"). Pure.
 */

/** Lower case, no accents, no punctuation, single spaces. */
export function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The main title: before a subtitle (": …", " - …") and without parentheses or a leading article. */
export function mainTitle(title: string): string {
  const main = title
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .split(/\s*[:;]\s+|\s+[-–—]\s+/)[0]!
  return fold(main).replace(/^(the|a|an|der|die|das|le|la|les) /, '')
}

/** Whether two titles name the same book (main titles equal). */
export function titlesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const x = mainTitle(a)
  const y = mainTitle(b)
  return x !== '' && x === y
}

/** The search text for a title: the main title as written, without a subtitle. */
export function searchTitle(title: string): string {
  return title.replace(/\s*[([].*?[)\]]\s*/g, ' ').split(/\s*[:;]\s+|\s+[-–—]\s+/)[0]!.trim() || title
}

function nameParts(name: string): string[] {
  return fold(name.replace(/\./g, ' ')).split(' ').filter(Boolean)
}

/**
 * Whether two author names are the same person's: equal when folded, or the
 * same surname with the same first initial ("Ursula K. Le Guin" and "Ursula
 * Le Guin", "H.G. Wells" and "Herbert George Wells").
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const x = nameParts(a)
  const y = nameParts(b)
  if (!x.length || !y.length) return false
  if (x.join(' ') === y.join(' ')) return true
  if (x.join('') === y.join('')) return true
  const surnameX = x[x.length - 1]
  const surnameY = y[y.length - 1]
  if (surnameX !== surnameY) return false
  if (x.length === 1 || y.length === 1) return false
  return x[0]![0] === y[0]![0]
}
