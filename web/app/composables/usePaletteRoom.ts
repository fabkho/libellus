import type { InjectionKey } from 'vue'

/**
 * The search palette's room (components/shell/SearchOverlay.vue), as what it
 * shows sees it. The palette is laid out at the full height it may take from
 * the moment it opens, and its content stands at the bottom of that room; how
 * much of the room the content fills is only drawn (the raised surface, its
 * shadow and its clip follow `--palette-gap`, the empty part above the
 * content). So results that arrive, leave or change never move a box that was
 * already on screen, and the browser does not count the palette growing as a
 * layout shift (Cumulative Layout Shift: before, the palette's shadow grew
 * upwards with every answer and scored a whole screen on the Library).
 *
 * `glide`: the next change of the filled height glides there over `standard`
 * (after `delay` ms) instead of jumping, as between the loading state and the
 * first results (docs/MOTION.md, Search loading).
 */
export type PaletteRoom = { glide: (delay?: number) => void }

export const PALETTE_ROOM: InjectionKey<PaletteRoom> = Symbol('palette-room')

/** The room of the palette around this component; null outside one. */
export function usePaletteRoom(): PaletteRoom | null {
  return inject(PALETTE_ROOM, null)
}

/**
 * Marks a container that fills the room rather than its content: its children
 * stand at its bottom, and the filled height is measured from them, not from it.
 */
export const ROOM_ATTRIBUTE = 'data-room'

/** The vertical translation an element is drawn with (its `translate` and `transform`), so a measure can leave it out. */
function drawnOffset(element: Element): number {
  const style = getComputedStyle(element)
  let offset = 0
  if (style.translate && style.translate !== 'none') offset += Number.parseFloat(style.translate.split(' ')[1] ?? '0') || 0
  if (style.transform && style.transform !== 'none') offset += new DOMMatrixReadOnly(style.transform).m42
  return offset
}

/**
 * Where the content of `element` starts (its top, in viewport pixels): a plain
 * element's own top; a room's (`data-room`), the top of its highest child less
 * its top padding, never above the room itself, and its bottom when it is
 * empty. Elements drawn moved (a row rising in) count where they are laid out.
 */
export function contentTop(element: Element): number {
  const rect = element.getBoundingClientRect()
  if (!element.hasAttribute(ROOM_ATTRIBUTE)) return rect.top - drawnOffset(element)
  let top = Number.POSITIVE_INFINITY
  for (const child of element.children) {
    if (!(child instanceof HTMLElement || child instanceof SVGElement)) continue
    if (getComputedStyle(child).display === 'none') continue
    top = Math.min(top, contentTop(child))
  }
  if (top === Number.POSITIVE_INFINITY) return rect.bottom
  const padding = Number.parseFloat(getComputedStyle(element).paddingTop) || 0
  return Math.max(rect.top, top - padding)
}
