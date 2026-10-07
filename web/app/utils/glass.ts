/**
 * How much the glass blurs (the owner's setting, Profile → Account → Glass): the
 * floating chrome's backdrop blur — the tab bar and the avatar menu (`glass`),
 * the round buttons over covers (`chrome`), the veil behind the search palette
 * (`veil`). A backdrop blur is recomputed every frame anything moves behind it
 * (a cover's flight, a page's fade, the search morph), which is GPU work a
 * phone feels and a desktop does not; this lets the owner compare on her phone.
 *
 * - `full`, the default: the design's radii (design/tokens.json, `blur.*`).
 * - `light`: half the radii.
 * - `off`: no backdrop blur at all; the glass keeps its tint.
 *
 * A setting of this device, like the theme (utils/theme.ts): in local storage,
 * outside the `libellus.` prefix that signing out clears. Framework-free, so
 * Vitest pins it in plain Node. The CSS that `data-glass` switches on is in
 * assets/css/main.css; the cover's halo is not glass and keeps its blur.
 */

export type GlassLevel = 'full' | 'light' | 'off'

export const GLASS_LEVELS: readonly GlassLevel[] = ['full', 'light', 'off']

/** The local-storage key. Not under `libellus.`: sign-out keeps it. */
export const GLASS_KEY = 'libellus-glass'

/** The slice of Storage the setting needs; `window.localStorage` fits. */
export type GlassStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** What a stored string means; anything unknown is the design's glass. */
export function parseGlass(raw: string | null | undefined): GlassLevel {
  return raw === 'light' || raw === 'off' ? raw : 'full'
}

export function readGlass(storage: GlassStorage): GlassLevel {
  try {
    return parseGlass(storage.getItem(GLASS_KEY))
  } catch {
    // Storage can be unavailable (private mode, blocked): the design's glass.
    return 'full'
  }
}

export function writeGlass(storage: GlassStorage, level: GlassLevel): void {
  try {
    storage.setItem(GLASS_KEY, level)
  } catch {
    // Not persisted, but the setting still holds for this visit.
  }
}

/** The slice of Document the setting touches. */
export type GlassDocument = {
  documentElement: { setAttribute: (name: string, value: string) => void; removeAttribute: (name: string) => void }
}

/** Puts a level on the page: `data-glass` on <html> for `light` and `off`, nothing for the design's own. */
export function applyGlass(doc: GlassDocument, level: GlassLevel): void {
  if (level === 'full') doc.documentElement.removeAttribute('data-glass')
  else doc.documentElement.setAttribute('data-glass', level)
}
