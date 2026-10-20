import type { CoverSize } from './runner.ts'

/** The size an address says it has: Open Library's `-S|M|L.jpg`, Goodreads' `…<id>s|m|l/`. Null when it does not say. */
export function coverSizeOf(url: string): CoverSize | null {
  const letter = /\/b\/id\/\d+-([SML])\.jpg$/.exec(url)?.[1] ?? /\/books\/\d+([sml])\//.exec(url)?.[1]?.toUpperCase()
  return letter === 'S' || letter === 'M' || letter === 'L' ? letter : null
}
