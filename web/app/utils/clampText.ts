/**
 * The pure parts of a clamped text (components/ui/ClampText.vue): whether the cut shows, and the
 * height keyframes of an expand or fold. No DOM here: the component reads the measurements and
 * animates with what these return, so the rules are tested in plain Vitest.
 */

/** A text is cut when its full height runs past the clamped box (1 px for rounding). */
export function isCut(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight + 1
}

/**
 * Keyframes for the height glide from the height shown before a toggle to the one after it, or
 * null when nothing should move: Reduce Motion, or the same height both ways.
 */
export function heightKeyframes(from: number, to: number, reduceMotion: boolean): Keyframe[] | null {
  if (reduceMotion || from === to) return null
  return [{ height: `${from}px` }, { height: `${to}px` }]
}
