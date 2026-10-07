/**
 * Runs `run` when the browser has nothing better to do, at the latest after
 * `timeout` ms; where there is no `requestIdleCallback` (Safari) a short while
 * later (`fallback` ms). Returns what cancels it. Framework-free.
 */
export function onIdle(run: () => void, { timeout = 3000, fallback = 1200 }: { timeout?: number; fallback?: number } = {}): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(run, fallback)
  return () => clearTimeout(id)
}
