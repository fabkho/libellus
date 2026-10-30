/**
 * What Regal's `preloadReelCovers` (utils/reel/preload.ts) is in a build without Regal (regal.config.ts): nothing to
 * warm. The section never mounts the reel then, and only asks for it in a build that has Regal (`appConfig.regal`).
 */
export async function preloadReelCovers(_library: unknown, _options?: Record<string, unknown>): Promise<void> {}
