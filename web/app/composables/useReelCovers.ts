import type { BothReadReelOptions } from '~/data/bothReadReel'

/**
 * How the reel's covers are asked for on this device (`covers` of `bothReadReelDocument`, data/bothReadReel.ts): the
 * pixel ratio (3 at most: a texture a step wider is not worth another cache entry), and, on a Pages build, our own
 * cache's address on the page's origin (`useCoverProxy`, utils/coverSize.ts; absolute, as Regal takes images). The
 * section and the warm-up ahead of a friend's page both build the document with it, so they name the same addresses.
 */
export function useReelCovers(): NonNullable<BothReadReelOptions['covers']> {
  const proxy = useCoverProxy()
  if (!import.meta.client) return { proxy: false }
  return { proxy, origin: window.location.origin, dpr: Math.min(3, Math.max(1, window.devicePixelRatio || 1)) }
}
