/**
 * When "You both read" draws its 3D reel instead of the poster (docs/plans/shared-books-slideshow.md, D: the
 * loading rules). All of them must hold; otherwise, and until the canvas says `ready`, the poster stays.
 * Pure: the section reads the world (build, motion setting, WebGL, Save-Data, the view) and asks here.
 */
export type ReelGate = {
  /** The build has Regal (`appConfig.regal`, LIBELLUS_REGAL=1, regal.config.ts). */
  built: boolean
  /** Books in the reel: one is a poster only, two or more can move. */
  count: number
  /** Reduce Motion. */
  reducedMotion: boolean
  /** The browser has WebGL. */
  webgl: boolean
  /** `navigator.connection.saveData`. */
  saveData: boolean
  /** The section is within a viewport height of the screen. */
  near: boolean
  /** The browser has gone idle once. */
  idle: boolean
}

export function reelWanted(gate: ReelGate): boolean {
  return gate.built && gate.count >= 2 && !gate.reducedMotion && gate.webgl && !gate.saveData && gate.near && gate.idle
}

/** Whether a WebGL context can be had at all (checked once, on a throwaway canvas). */
export function hasWebgl(doc: Pick<Document, 'createElement'> = document): boolean {
  try {
    const canvas = doc.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** `navigator.connection.saveData` where the browser tells (Chromium); false elsewhere. */
export function saveDataOn(nav: { connection?: { saveData?: boolean } } = navigator): boolean {
  return nav.connection?.saveData === true
}

/** The slot a Book has in the poster's resting pose, by its distance to the Book in front (−2 … 2; further: hidden). */
export type PosterSlot = { x: number; scale: number; opacity: number }

/** The poster's slots: `x` in front-cover widths, so the pose scales with the cover token (A · Reel at rest). */
export const POSTER_SLOTS: Readonly<Record<0 | 1 | 2, PosterSlot>> = {
  0: { x: 0, scale: 1, opacity: 1 },
  1: { x: 0.84, scale: 0.8, opacity: 1 },
  2: { x: 1.4, scale: 0.62, opacity: 0.5 },
}

/** The slot of the Book `offset` places from the front: left of it negative. Null: not drawn. */
export function posterSlot(offset: number): PosterSlot | null {
  const distance = Math.abs(offset)
  if (distance > 2) return null
  const slot = POSTER_SLOTS[distance as 0 | 1 | 2]
  return { ...slot, x: offset < 0 ? -slot.x : slot.x }
}
