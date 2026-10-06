// Cloudflare Pages Function (docs/HOSTING.md): the share target's POST to /share (#91, #131) when
// no service worker answered it — the very first share right after installing, before the service
// worker took control. A static host cannot keep files, so this only sends the app to the GET
// address the page reads: a title, text or link as before, and `ebooks=missed` when files were
// shared, so the page can ask for the share again. Normally public/sw-share.js answers the POST on
// the device and this never runs. A GET to /share is not handled here and gets the static page.
export async function onRequestPost({ request }) {
  const next = new URLSearchParams()
  try {
    const form = await request.formData()
    for (const key of ['title', 'text', 'url']) {
      const value = form.get(key)
      if (typeof value === 'string' && value) next.set(key, value)
    }
    if (form.getAll('ebooks').some((value) => typeof value !== 'string')) next.set('ebooks', 'missed')
  } catch {
    // Not a form: the app opens at /share and goes Home.
  }
  const query = next.toString()
  return Response.redirect(new URL(query ? `/share?${query}` : '/share', request.url).toString(), 303)
}
