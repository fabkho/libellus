/**
 * Boxes on screen, as the reader needs them (#131 phase 2): the words a member
 * selected, and the highlight she tapped. A selection lives in the book's frame,
 * so every box it reports is in the frame's own coordinates; the reader's menu
 * and handles are drawn on the app's layer, so the boxes are shifted by where
 * the frame stands.
 *
 * Framework-free: a rect and a frame's corner come in as plain boxes, never as
 * a `DOMRect` read off the page, so Vitest pins the arithmetic in plain Node and
 * a native port reimplements it 1:1. What is read off a live `Range` stays in
 * `reader/engine.ts` (`describeRange`).
 */

/** A box on screen: left, top, width, height in CSS px. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** The part of a rect this reads (a `DOMRect` has all of them). */
export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/** Where a frame stands on the page; null when the box is not in a frame. */
export type FrameOrigin = { left: number; top: number } | null

/**
 * A box from inside a frame, in the app's coordinates: its own, moved by the
 * frame's corner. A box outside any frame (a mouse selection in the page
 * itself) comes back as it is.
 */
export function shiftRect(rect: RectLike, frame: FrameOrigin): Box {
  return { left: (frame?.left ?? 0) + rect.left, top: (frame?.top ?? 0) + rect.top, width: rect.width, height: rect.height }
}

/**
 * A selection's line boxes, in the app's coordinates, with the ones that carry
 * nothing dropped: a line no wider than half a pixel (a space at a line's end, a
 * collapsed rect) or one with no height is not drawn.
 */
export function shiftRects(rects: readonly RectLike[], frame: FrameOrigin): Box[] {
  return rects.filter((r) => r.width > 0.5 && r.height > 0).map((r) => shiftRect(r, frame))
}

/**
 * A range as the reader's menu needs it: the words (whitespace folded, trimmed),
 * the place, and the boxes on screen — every line's, the first and the last
 * (the menu sits above the first or below the last), and the whole range's,
 * standing for the one box when no line carried anything.
 *
 * `words` is `range.toString()` and `index` the section the book is in;
 * `cfi` is the range's place in that section, which the engine asks foliate
 * for (`view.getCFI`). Null when the range holds no words at all.
 */
export function describeSelection(
  words: string,
  cfi: string,
  index: number,
  rect: RectLike,
  rects: readonly RectLike[],
  frame: FrameOrigin,
  custom: boolean,
): {
  text: string
  cfi: string
  index: number
  rect: Box
  first: Box
  last: Box
  rects: Box[]
  custom: boolean
} | null {
  const text = words.replace(/\s+/g, ' ').trim()
  if (!text) return null
  const lines = shiftRects(rects, frame)
  const box = shiftRect(rect, frame)
  return { text, cfi, index, rect: box, first: lines[0] ?? box, last: lines.at(-1) ?? box, rects: lines, custom }
}
