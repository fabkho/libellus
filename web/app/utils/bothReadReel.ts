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

/**
 * Whether a WebGL context can be had at all (a throwaway canvas). The context is let go at once
 * (`WEBGL_lose_context`): browsers keep a handful of live contexts, and the reel's own canvas needs one.
 */
export function hasWebgl(doc: Pick<Document, 'createElement'> = document): boolean {
  try {
    const canvas = doc.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as { getExtension?: (name: string) => { loseContext?: () => void } | null } | null
    if (!gl) return false
    try {
      gl.getExtension?.('WEBGL_lose_context')?.loseContext?.()
    } catch {
      // Nothing to let go of.
    }
    return true
  } catch {
    return false
  }
}

let webgl: boolean | null = null
/** `hasWebgl` for this page load: asked once, whatever number of friends' pages are opened. */
export function webglAvailable(): boolean {
  return (webgl ??= hasWebgl())
}

/** `navigator.connection.saveData` where the browser tells (Chromium); false elsewhere. */
export function saveDataOn(nav: { connection?: { saveData?: boolean } } = navigator): boolean {
  return nav.connection?.saveData === true
}

/**
 * A connection or a device that should not be given background downloads: a 2g or slow-2g connection
 * (`navigator.connection.effectiveType`), or a phone with 2 GB of memory or less (`navigator.deviceMemory`, Chromium).
 * A tap on a friend is still served; what is fetched on idle, ahead of anybody asking, is not.
 */
export function slowDevice(nav: { connection?: { effectiveType?: string }; deviceMemory?: number } = navigator): boolean {
  const type = nav.connection?.effectiveType
  return type === 'slow-2g' || type === '2g' || (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2)
}

/**
 * Starts fetching Regal's chunk (the reel and its still) as early as the page knows it may be wanted, instead of when
 * the section is drawn: a dynamic import, which the build's guard allows (regal.config.ts). A build without Regal
 * resolves it to the empty stand-in; Save-Data does not fetch ahead, nor (`background`: nobody has asked for the page,
 * a row came into view or a release was installed) a slow connection or device. A failure is only a failure to be early.
 */
export function prefetchBothReadReel(built: boolean, { background = false }: { background?: boolean } = {}): void {
  if (!built || typeof window === 'undefined' || saveDataOn() || (background && slowDevice())) return
  void import('../components/friends/BothReadReel.vue').catch(() => undefined)
}
