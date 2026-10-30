// Kept apart from utils/bothReadReel.ts (pure, tested in Node): this one reaches for the Regal layer's alias.
/**
 * Asks for the covers of the reel's first frame now, as Regal's `preloadReelCovers` does (a few files of its own, no
 * three.js: the `regal-preload` chunk, regal.config.ts), long before the reel's chunk is in. `autoplay` and
 * `reducedMotion` are the reel's own, which decide which Books its first frame shows. Once per library object; a
 * failure is only a failure to be early.
 */
export function preloadReelCovers(library: unknown, options: { autoplay?: boolean; reducedMotion?: boolean }): void {
  if (typeof window === 'undefined') return
  void import('#layers/regal/app/utils/reel/preload').then((regal) => regal.preloadReelCovers(library as never, options)).catch(() => undefined)
}
