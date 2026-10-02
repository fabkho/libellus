const preloaded = new Set<string>()

/**
 * Starts downloading an image before anything shows it (the first covers of a
 * result list, the cover of a book page about to open), so it is in the cache
 * by the time its <img> asks. Each URL once per visit.
 */
export function preloadImage(url: string | null | undefined) {
  if (!url || preloaded.has(url) || typeof Image === 'undefined') return
  preloaded.add(url)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
}
