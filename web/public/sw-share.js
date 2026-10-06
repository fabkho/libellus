// The share target (issues #91 and #131), imported by the generated service worker
// (nuxt.config.ts, pwa.workbox.importScripts). The manifest has one share_target, and
// files make it a POST with multipart/form-data, so every share arrives here:
//
//   - with EPUB files (`ebooks`, one or many): they are kept in Cache Storage
//     (`libellus-shared-ebooks`, under /__shared/<id>/<n>, with their names, types and
//     sizes in /__shared/<id>/meta) and the app opens at /share?ebooks=<id>, which takes
//     them in (copies them into the device's own storage, links them to Books) and
//     removes them from the cache. Nothing is uploaded: the files never leave the device.
//   - with a title, text or link only (#91): the app opens at the same GET address as
//     before, /share?title=&text=&url=.
//
// A 303 after the POST, so a reload or Back never posts again. Workbox only answers GETs,
// so this listener is the only one that answers a POST to /share. Signing out deletes
// the cache (data/localData.ts, clearLocalFiles).
const SHARED_EBOOKS_CACHE = 'libellus-shared-ebooks'

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname.replace(/\/+$/, '') !== '/share') return
  event.respondWith(receiveShare(event.request))
})

async function receiveShare(request) {
  let form
  try {
    form = await request.formData()
  } catch {
    return Response.redirect('/share', 303)
  }
  const fields = {}
  const files = []
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value
    else if (key === 'ebooks' && value.size > 0) files.push(value)
  }
  if (!files.length) {
    const next = new URLSearchParams()
    for (const key of ['title', 'text', 'url']) if (fields[key]) next.set(key, fields[key])
    const query = next.toString()
    return Response.redirect(query ? `/share?${query}` : '/share', 303)
  }
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  try {
    const cache = await caches.open(SHARED_EBOOKS_CACHE)
    const meta = []
    for (const [index, file] of files.entries()) {
      const type = file.type || 'application/epub+zip'
      await cache.put(`/__shared/${id}/${index}`, new Response(file, { headers: { 'Content-Type': type } }))
      meta.push({ index, name: file.name || `shared-${index + 1}.epub`, type, size: file.size, lastModified: file.lastModified })
    }
    // The list last: a share whose files are not all kept is never taken half.
    await cache.put(`/__shared/${id}/meta`, new Response(JSON.stringify({ id, files: meta }), { headers: { 'Content-Type': 'application/json' } }))
  } catch {
    // No room to keep them: the app says the share was missed, so she can try again.
    return Response.redirect('/share?ebooks=missed', 303)
  }
  return Response.redirect(`/share?ebooks=${id}`, 303)
}
