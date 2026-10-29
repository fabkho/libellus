/**
 * When "You both read" draws Regal's live 3D reel (docs/plans/shared-books-slideshow.md, D: the loading rules).
 * All of them must hold; otherwise the section shows `RegalBooksReelStill`, the reel's own first frame, and nothing
 * moves. (While the reel loads it draws its own first frame, so there is no poster of ours to wait under.)
 * Pure: the section reads the world (build, motion setting, WebGL, Save-Data) and asks here.
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
}

export function reelWanted(gate: ReelGate): boolean {
  return gate.built && gate.count >= 2 && !gate.reducedMotion && gate.webgl && !gate.saveData
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

const warmed = new Map<string, HTMLImageElement>()

/**
 * Starts fetching images now, as the canvas will read them (with CORS, so the answer is the one it reuses): the
 * reel's first covers are in the browser's cache when Regal's chunk arrives. Once per address; a missing cover or an
 * `Image` the browser does not have is not an error. Kept referenced until loaded, so none is dropped half-way.
 */
export function preloadCovers(urls: readonly string[], make: () => HTMLImageElement = () => new Image()): void {
  for (const url of urls) {
    if (warmed.has(url)) continue
    try {
      const image = make()
      image.crossOrigin = 'anonymous'
      image.decoding = 'async'
      const done = () => warmed.delete(url)
      image.onload = image.onerror = done
      image.src = url
      warmed.set(url, image)
    } catch {
      // The browser has no Image (a test, a worker): nothing to warm.
    }
  }
}

/**
 * Starts fetching Regal's chunk (the reel and its still) as early as the page knows it may be wanted, instead of when
 * the section is drawn: a dynamic import, which the build's guard allows (regal.config.ts). A build without Regal
 * resolves it to the empty stand-in; Save-Data does not fetch ahead. A failure is only a failure to be early.
 */
export function prefetchBothReadReel(built: boolean): void {
  if (!built || typeof window === 'undefined' || saveDataOn()) return
  void import('../components/friends/BothReadReel.vue').catch(() => undefined)
}
