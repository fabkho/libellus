/**
 * Records fixtures/: the public covers the tests answer from (one Apple book at its four widths and the 66x100 probe, an
 * Open Library cover by id at S/M/L, and a Goodreads image at two sizes). These are the covers of public books named in
 * the repo's other fixtures, never a member's. Run by hand (identified, as the function is, and gently):
 *
 *   OPENLIBRARY_CONTACT=you@example.com deno run --allow-net --allow-write --allow-env record_fixtures.ts
 *
 * The tests then run on these files and never reach the network. The Goodreads `._SX318_` / `._SX100_` sizes are Goodreads'
 * own resizer, used here only to keep the fixtures small (the function itself stores the one image an address names).
 */
const contact = Deno.env.get('OPENLIBRARY_CONTACT')
if (!contact) throw new Error('OPENLIBRARY_CONTACT, please')

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication122/v4/8d/3a/b4/8d3ab462-68ce-30ba-a9da-610286c41f49/9783641264864.jpg'
const GOODREADS = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1689110385i/187957173'
const files: Record<string, string> = {
  'apple-600x900.webp': `${APPLE}/600x900bb.webp`,
  'apple-360x540.webp': `${APPLE}/360x540bb.webp`,
  'apple-240x360.webp': `${APPLE}/240x360bb.webp`,
  'apple-120x180.webp': `${APPLE}/120x180bb.webp`,
  'apple-66x100.jpg': `${APPLE}/66x100bb.jpg`,
  'ol-L.jpg': 'https://covers.openlibrary.org/b/id/8231856-L.jpg?default=false',
  'ol-M.jpg': 'https://covers.openlibrary.org/b/id/8231856-M.jpg?default=false',
  'ol-S.jpg': 'https://covers.openlibrary.org/b/id/8231856-S.jpg?default=false',
  'goodreads.jpg': `${GOODREADS}._SX318_.jpg`,
  'goodreads-100.jpg': `${GOODREADS}._SX100_.jpg`,
}

for (const [name, url] of Object.entries(files)) {
  const response = await fetch(url, { headers: { 'user-agent': `Libellus/1.0 (${contact})` }, redirect: 'follow' })
  if (!response.ok) throw new Error(`${name}: ${response.status}`)
  await Deno.writeFile(new URL(`./fixtures/${name}`, import.meta.url), new Uint8Array(await response.arrayBuffer()))
  console.log(name)
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
