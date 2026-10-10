// The share target (issues #91 and #131), imported by the generated service worker
// (nuxt.config.ts, pwa.workbox.importScripts). The manifest has one share_target, and
// files make it a POST with multipart/form-data, so every share arrives here:
//
//   - with EPUB files (`ebooks`, one or many): they are kept in Cache Storage
//     (`libellus-shared-ebooks`, under /__shared/<id>/<n>, with their names, types and
//     sizes in /__shared/<id>/meta) and the app opens at /share?ebooks=<id>, which lists
//     them and asks "Add N ebooks shared to Libellus?". Only the member's tap there takes
//     them in (copies them into the device's own storage, links them to Books) and removes
//     them from the cache; "Not now" removes them without. Nothing is uploaded: the files
//     never leave the device.
//   - with a title, text or link only (#91): the app opens at the same GET address as
//     before, /share?title=&text=&url=.
//
// Any page on the web can submit that same form (security round, October 2026, F4), so:
//   1. a POST that the browser says came from another site (`Sec-Fetch-Site: cross-site` or
//      `same-site`, or an `Origin` that is another origin) is dropped, nothing kept. An OS
//      share intent is `none` (or sends neither header); the worker is not always shown these
//      headers, so this is a first line only:
//   2. whatever is kept waits for the tap (pages/share.vue): nothing is ever imported by a POST.
// Only files that look like an EPUB (a name ending .epub or the EPUB type, and a zip's first
// bytes) are kept, at most MAX_FILES of at most MAX_FILE_BYTES each, and a share nobody
// confirmed is deleted after KEEP_MS (here, at the next share, and by the page).
//
// A 303 after the POST, so a reload or Back never posts again. Workbox only answers GETs,
// so this listener is the only one that answers a POST to /share. Signing out deletes
// the cache (data/localData.ts, clearLocalFiles). The same limits are in data/ebooks/shared.ts.
const SHARED_EBOOKS_CACHE = 'libellus-shared-ebooks'
const MAX_FILES = 20
const MAX_FILE_BYTES = 100 * 1024 * 1024
const KEEP_MS = 60 * 60 * 1000

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname.replace(/\/+$/, '') !== '/share') return
  event.respondWith(receiveShare(event.request))
})

/** A 303 to an address of this app: a reload or Back never posts again. */
function seeOther(path) {
  return Response.redirect(new URL(path, self.location.origin).href, 303)
}

/** Whether the browser says this request was made by a page of another site (or origin). */
function fromAnotherSite(request) {
  const site = request.headers.get('Sec-Fetch-Site')
  if (site) return site !== 'same-origin' && site !== 'none'
  const origin = request.headers.get('Origin')
  // `null` is what a share intent or a sandboxed frame may send: not proof of anything, the tap decides.
  return Boolean(origin) && origin !== 'null' && origin !== self.location.origin
}

/** Whether a shared file may be kept: an EPUB by its name or type, a zip by its first bytes, within the size limit. */
async function isKeepable(file) {
  if (!file.size || file.size > MAX_FILE_BYTES) return false
  if (!/\.epub$/i.test(file.name || '') && file.type !== 'application/epub+zip') return false
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
}

/** Deletes the shares nobody confirmed within KEEP_MS (and the ones whose list is missing). */
async function dropStale(cache) {
  const keys = await cache.keys()
  const metas = keys.filter((request) => new URL(request.url).pathname.endsWith('/meta'))
  const live = new Set()
  for (const request of metas) {
    const meta = await (await cache.match(request))?.json().catch(() => null)
    if (meta && typeof meta.at === 'number' && Date.now() - meta.at < KEEP_MS) live.add(new URL(request.url).pathname.split('/')[2])
  }
  for (const request of keys) if (!live.has(new URL(request.url).pathname.split('/')[2])) await cache.delete(request)
}

async function receiveShare(request) {
  // Not from this app, not from the OS: nothing is read, nothing kept.
  if (fromAnotherSite(request)) return seeOther('/')
  let form
  try {
    form = await request.formData()
  } catch {
    return seeOther('/share')
  }
  const fields = {}
  const offered = []
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value
    else if (key === 'ebooks' && value.size > 0) offered.push(value)
  }
  if (!offered.length) {
    const next = new URLSearchParams()
    for (const key of ['title', 'text', 'url']) if (fields[key]) next.set(key, fields[key])
    const query = next.toString()
    return seeOther(query ? `/share?${query}` : '/share')
  }
  const files = []
  for (const file of offered.slice(0, MAX_FILES)) if (await isKeepable(file)) files.push(file)
  // Nothing that is an EPUB, or too many or too large: the app says the share did not arrive.
  if (!files.length) return seeOther('/share?ebooks=missed')
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  try {
    const cache = await caches.open(SHARED_EBOOKS_CACHE)
    await dropStale(cache)
    const meta = []
    for (const [index, file] of files.entries()) {
      const type = file.type || 'application/epub+zip'
      await cache.put(`/__shared/${id}/${index}`, new Response(file, { headers: { 'Content-Type': type } }))
      meta.push({ index, name: file.name || `shared-${index + 1}.epub`, type, size: file.size, lastModified: file.lastModified })
    }
    // The list last: a share whose files are not all kept is never taken half.
    await cache.put(
      `/__shared/${id}/meta`,
      new Response(JSON.stringify({ id, at: Date.now(), skipped: offered.length - files.length, files: meta }), { headers: { 'Content-Type': 'application/json' } }),
    )
  } catch {
    // No room to keep them: the app says the share was missed, so she can try again.
    return seeOther('/share?ebooks=missed')
  }
  return seeOther(`/share?ebooks=${id}`)
}
