/**
 * The reader's settings (#131 phase 2): how a book is set on this device —
 * pages or scroll, the printed page or the classic one, the room, the type.
 * A setting of the device, not of the member, like the app's theme
 * (utils/theme.ts): kept in local storage outside the `libellus.` prefix that
 * signing out clears. Framework-free; a native port reads the steps from here.
 */
export type ReaderTheme = 'light' | 'dark' | 'sepia'

export interface ReaderSettings {
  /** Pages, or one scrolling page per chapter. */
  flow: 'pages' | 'scroll'
  /** The printed page (the default: a folio, a small capsule) or the classic one (bars at the top and the bottom). */
  style: 'printed' | 'classic'
  /** The reader's room; sepia by default whatever the app's theme. null: the app's own. */
  theme: ReaderTheme | null
  font: 'serif' | 'sans'
  /** Index into FONT_SIZES. */
  size: number
  /** Index into LEADINGS. */
  leading: number
  /** Index into MARGINS. */
  margins: number
  justify: boolean
  keepAwake: boolean
  /** The language Translate goes into (ISO 639-1); null: the device's own (see lookup.ts, defaultTarget). */
  translateTo: string | null
}

/** Text sizes in CSS px: seven steps, 18 the default. */
export const FONT_SIZES = [15, 16.5, 18, 19.5, 21, 23, 25.5] as const
/** Line heights: tight, snug, the default, airy. */
export const LEADINGS = [1.3, 1.42, 1.55, 1.72] as const
/**
 * Margins, from edge to edge (the most text a screen holds at a readable size)
 * to wide: `side` is the share of the width on each side, `band` the px above
 * and below the text (the device's insets are added by the reader's page, not
 * here), `measure` the widest a line may get on a large screen.
 */
export const MARGINS = [
  { side: 0.018, band: 10, measure: 1100 },
  { side: 0.05, band: 24, measure: 760 },
  { side: 0.075, band: 34, measure: 640 },
  { side: 0.11, band: 44, measure: 560 },
] as const

export const DEFAULT_SETTINGS: ReaderSettings = {
  flow: 'pages',
  style: 'printed',
  theme: 'sepia',
  font: 'serif',
  size: 2,
  leading: 2,
  margins: 2,
  justify: true,
  keepAwake: true,
  translateTo: null,
}

/** The local-storage key. Not under `libellus.`: signing out keeps it, as the theme. */
export const READER_SETTINGS_KEY = 'libellus-reader'

type Storage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }

const inRange = (n: unknown, length: number) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < length

/** What a stored string means: every known, valid field over the defaults; anything else is the default. */
export function parseSettings(raw: string | null): ReaderSettings {
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null')
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>
  } catch {
    // Unreadable: the defaults.
  }
  const s = { ...DEFAULT_SETTINGS }
  if (stored.flow === 'pages' || stored.flow === 'scroll') s.flow = stored.flow
  if (stored.style === 'printed' || stored.style === 'classic') s.style = stored.style
  if (stored.theme === null || stored.theme === 'light' || stored.theme === 'dark' || stored.theme === 'sepia') s.theme = stored.theme
  if (stored.font === 'serif' || stored.font === 'sans') s.font = stored.font
  if (inRange(stored.size, FONT_SIZES.length)) s.size = stored.size as number
  if (inRange(stored.leading, LEADINGS.length)) s.leading = stored.leading as number
  if (inRange(stored.margins, MARGINS.length)) s.margins = stored.margins as number
  if (typeof stored.justify === 'boolean') s.justify = stored.justify
  if (typeof stored.keepAwake === 'boolean') s.keepAwake = stored.keepAwake
  if (stored.translateTo === null || (typeof stored.translateTo === 'string' && /^[a-z]{2}$/.test(stored.translateTo))) s.translateTo = stored.translateTo as string | null
  return s
}

export function readSettings(storage: Pick<Storage, 'getItem'>): ReaderSettings {
  try {
    return parseSettings(storage.getItem(READER_SETTINGS_KEY))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(storage: Pick<Storage, 'setItem'>, settings: ReaderSettings): void {
  try {
    storage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable: the settings last for this visit.
  }
}
