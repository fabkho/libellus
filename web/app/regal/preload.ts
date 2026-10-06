/**
 * What Regal's `preloadRegal` (composables/useShelfPreload.ts) is in a build without Regal
 * (regal.config.ts): nothing to warm. Nobody is the shelf's owner then, so nothing calls it.
 */
export async function preloadRegal(_options: Record<string, unknown>): Promise<void> {}
