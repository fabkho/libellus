import { describe, expect, it } from 'vitest'
import { onRequestGet } from '../functions/manifest.webmanifest.js'
import { germanManifest, prefersGerman } from '@/utils/manifestText'

/**
 * The manifest in German (German group B of #257): a browser whose first language the app speaks is German gets
 * the German description and shortcut names with `lang: de`; every other request gets the built manifest as
 * it is. `name`, `short_name`, icons, share target and the shortcut addresses never change.
 */
const BUILT = {
  id: '/',
  name: 'BetterReads',
  short_name: 'BetterReads',
  description: 'Your books: what you want to read, what you are reading, what you have read.',
  lang: 'en',
  start_url: '/',
  icons: [{ src: '/icon-192.png', sizes: '192x192' }],
  share_target: { action: '/share', method: 'POST' },
  shortcuts: [
    { name: 'Search', short_name: 'Search', description: 'Find a book to add', url: '/?search=1' },
    { name: 'Update progress', short_name: 'Progress', description: 'Update the book you are reading', url: '/?progress=1' },
    { name: 'Library', short_name: 'Library', description: 'Your books', url: '/library' },
    { name: 'Later', short_name: 'Later', description: 'A shortcut with no German yet', url: '/later' },
  ],
}

function ask(acceptLanguage: string | null, answer: () => Response = () => new Response(JSON.stringify(BUILT), { headers: { 'content-type': 'application/manifest+json', 'content-length': '999' } })) {
  const headers = acceptLanguage === null ? {} : { 'accept-language': acceptLanguage }
  return onRequestGet({ request: new Request('https://libellus.test/manifest.webmanifest', { headers }), env: { ASSETS: { fetch: async () => answer() } } })
}

describe('which browsers get German', () => {
  it('takes the first language the app speaks, by quality and then by order', () => {
    for (const header of ['de', 'de-DE', 'de-AT,de;q=0.9,en;q=0.8', 'fr-CH, de;q=0.9, en;q=0.8', 'DE_de', 'en;q=0.5, de;q=0.9', '*, de'.replace('*, ', '')]) {
      expect(prefersGerman(header), header).toBe(true)
    }
    for (const header of ['en', 'en-GB,de;q=0.5', 'fr', 'fr,en;q=0.8,de;q=0.7', 'de;q=0', '', '*', null, undefined]) {
      expect(prefersGerman(header as string | null | undefined), String(header)).toBe(false)
    }
  })
})

describe('the manifest answer', () => {
  it('is the built file, untouched, for a browser that is not German', async () => {
    for (const language of ['en-US,en;q=0.9', 'fr-FR', null]) {
      const response = await ask(language)
      expect(await response.json(), String(language)).toEqual(BUILT)
      expect(response.headers.get('vary')).toBe('Accept-Language')
      expect(response.headers.get('cache-control')).toBe('no-cache')
    }
  })

  it('is German for a German browser: lang, description and the shortcuts; the brand and the rest stay', async () => {
    const response = await ask('de-DE,de;q=0.9,en;q=0.8')
    const manifest = await response.json()
    expect(manifest.lang).toBe('de')
    expect(manifest.description).toBe('Deine Bücher: was du lesen möchtest, was du gerade liest und was du gelesen hast.')
    expect(manifest.shortcuts.map((s: { name: string }) => s.name)).toEqual(['Suche', 'Fortschritt aktualisieren', 'Bibliothek', 'Later'])
    expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(BUILT.shortcuts.map((s) => s.url))
    // What a manifest must keep.
    expect(manifest).toMatchObject({ id: '/', name: 'BetterReads', short_name: 'BetterReads', start_url: '/', icons: BUILT.icons, share_target: BUILT.share_target })
    expect(response.headers.get('content-type')).toBe('application/manifest+json')
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('vary')).toBe('Accept-Language')
    // It is a translation, not a rewrite: the built object is not touched.
    expect(BUILT.lang).toBe('en')
    expect(germanManifest(BUILT).shortcuts![3]!.name).toBe('Later')
  })

  it('hands the asset back as it is when it is missing or is not JSON, even to a German browser', async () => {
    const missing = await ask('de', () => new Response('nope', { status: 404 }))
    expect(missing.status).toBe(404)
    const broken = await ask('de', () => new Response('<html>', { status: 200 }))
    expect(broken.status).toBe(200)
    expect(await broken.text()).toBe('<html>')
  })
})
