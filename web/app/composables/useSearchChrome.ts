/**
 * Who draws the bottom chrome while search opens and closes, shared by the tab
 * bar and the search overlay (docs/MOTION.md, Search morph):
 *
 * - `tabs`: the tab bar, as always while search is closed;
 * - `morph`: the capsule is turning into the palette or back. The tab bar stays
 *   where it is under the veil, but its Search icon is hidden: the overlay
 *   flies its own copy between the capsule and the query row;
 * - `palette`: the palette is open and has taken the tab bar's place.
 *
 * View state of the shell's motion, not of search, so it lives here rather than
 * in stores/search.ts.
 */
export type SearchChrome = 'tabs' | 'morph' | 'palette'

export function useSearchChrome() {
  return useState<SearchChrome>('search.chrome', () => 'tabs')
}
