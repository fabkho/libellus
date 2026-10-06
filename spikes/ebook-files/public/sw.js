// Spike service worker: the share target with files (#131 phase 0), compatible with #91's text/URL share.
//   POST /share (multipart/form-data): title/text/url + ebooks[]
//   - with files: keep them in Cache Storage 'shared-ebooks' (names, sizes, MIME as received), 303 → /?shared=<id>
//   - text/URL only: 303 → GET /share?title=&text=&url= (what pages/share.vue reads today)
const log = (msg) => fetch('/__log', { method: 'POST', body: `SW ${msg}` }).catch(() => {})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.pathname === '/share') event.respondWith(handleShare(event.request))
})

async function handleShare(request) {
  const started = performance.now()
  const form = await request.formData()
  const files = []
  const fields = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value
    else files.push({ field: key, name: value.name, size: value.size, type: value.type, lastModified: value.lastModified, file: value })
  }
  const elapsed = Math.round(performance.now() - started)
  log(`share POST: fields=${JSON.stringify(fields)} files=${files.length} parsed in ${elapsed} ms ${JSON.stringify(files.map(({ file, ...rest }) => rest))}`)
  if (!files.length) {
    const next = new URL('/share', request.url)
    for (const key of ['title', 'text', 'url']) if (fields[key]) next.searchParams.set(key, fields[key])
    log(`text share → redirect ${next.pathname}${next.search}`)
    return Response.redirect(`${next.pathname}${next.search}`, 303)
  }
  const id = String(Date.now())
  const cache = await caches.open('shared-ebooks')
  const meta = []
  for (const [index, item] of files.entries()) {
    await cache.put(`/__shared/${id}/${index}`, new Response(item.file, { headers: { 'Content-Type': item.type || 'application/octet-stream' } }))
    meta.push({ index, field: item.field, name: item.name, size: item.size, type: item.type, lastModified: item.lastModified })
  }
  await cache.put(`/__shared/${id}/meta`, new Response(JSON.stringify({ id, fields, files: meta, parsedMs: elapsed })))
  return Response.redirect(`/?shared=${id}`, 303)
}
