/**
 * The member's reading settings (the Aa sheet), kept on this device like the
 * app's theme (never in Supabase). Framework-free, so a native port reads the
 * steps from here.
 */
export type ReaderTheme = 'light' | 'dark' | 'sepia'

export interface ReaderSettings {
  /** c, the printed page (running head, folio, the capsule), or a, the classic one (bars top and bottom). */
  style: 'printed' | 'classic'
  /** Pages (a, c) or one scrolling page per chapter (b's way). */
  flow: 'pages' | 'scroll'
  font: 'serif' | 'sans'
  /** Index into FONT_SIZES. */
  size: number
  /** Index into LEADINGS. */
  leading: number
  /** Index into MARGINS. */
  margins: number
  justify: boolean
  /** The reader's room; sepia by default whatever the app's theme (owner, round 3). null: the app's own. */
  theme: ReaderTheme | null
  keepAwake: boolean
}

/** Text sizes in CSS px: seven steps, 18 the default (the app's `input` is 19, `callout` 17). */
export const FONT_SIZES = [15, 16.5, 18, 19.5, 21, 23, 25.5] as const
/** Line heights: tight, snug, the default, airy. */
export const LEADINGS = [1.3, 1.42, 1.55, 1.72] as const
/**
 * Margins, from edge to edge (the most text a screen holds at a readable size:
 * a few px at the sides so no letter touches the glass, the top and bottom
 * bands down to the status bar and a hair) to wide. `side` is the share of the
 * width on each side (paginator `gap`), `band` the px above and below the text
 * besides the safe area, `measure` the widest a line may get on a big screen.
 */
export const MARGINS = [
  { side: 0.018, band: 10, measure: 1100 },
  { side: 0.05, band: 24, measure: 760 },
  { side: 0.075, band: 34, measure: 640 },
  { side: 0.11, band: 44, measure: 560 },
] as const

export const DEFAULT_SETTINGS: ReaderSettings = {
  style: 'printed',
  flow: 'pages',
  font: 'serif',
  size: 2,
  leading: 2,
  margins: 2,
  justify: true,
  theme: 'sepia',
  keepAwake: true,
}

const KEY = 'libellus-reader-proto'
const SETTINGS_VERSION = 3

export function readSettings(storage: Pick<Storage, 'getItem'>): ReaderSettings {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? 'null') as (Partial<ReaderSettings> & { v?: number }) | null
    // Settings from before a change of steps or defaults (edge to edge, tight lines, sepia first) start over.
    if (!raw || raw.v !== SETTINGS_VERSION) return { ...DEFAULT_SETTINGS }
    const { v: _v, ...rest } = raw
    return { ...DEFAULT_SETTINGS, ...rest }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(storage: Pick<Storage, 'setItem'>, settings: ReaderSettings) {
  try {
    storage.setItem(KEY, JSON.stringify({ ...settings, v: SETTINGS_VERSION }))
  } catch {
    // Storage unavailable: the settings last for this visit.
  }
}
