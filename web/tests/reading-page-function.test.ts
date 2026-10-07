import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createAuth } from '@/data/auth'
import { createLibrary } from '@/data/library'
// The Pages Function itself, as Cloudflare loads it: plain ESM, driven here with
// a context the test builds (docs/HOSTING.md, "The Pages Functions").
import { onRequest } from '../functions/r/[[path]].js'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, sql, stack, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The link previews of a shared reading page (issue #171), against the local
 * stack: `web/functions/r/[[path]].js` asks the same public database functions
 * the app does, writes the Open Graph tags into the app shell, and serves the
 * picture by way of the `reading-page-og` edge function. Only that edge
 * function and the renderer behind it are stood in for; the database is real,
 * so a renewed or switched-off link really does stop the preview.
 */

const SITE = 'https://libellus.fabkho.dev'

/** The shell Pages would serve: short, with the two places the Function writes into. */
const SHELL = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Libellus</title></head><body><div id="__nuxt"></div></body></html>'

/** A 2×3 PNG: what the stand-in renderer answers with. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEElEQVR4nGPYUqEBRAwoFABXCQf5h5XBIQAAAABJRU5ErkJggg==', 'base64')

const COVER = 'https://covers.libellus.test/piranesi.jpg'

type Context = Parameters<typeof onRequest>[0]

/** The context Pages hands a Function: the request, the bindings, the asset server. */
function context(path: string, { env = {} as Record<string, string> } = {}): Context {
  const waited: Promise<unknown>[] = []
  return {
    request: new Request(`${SITE}${path}`),
    env: {
      NUXT_PUBLIC_SUPABASE_URL: stack.url,
      NUXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
      ...env,
      ASSETS: {
        fetch: () =>
          Promise.resolve(new Response(SHELL, { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0' } })),
      },
    },
    waitUntil: (promise: Promise<unknown>) => void waited.push(promise),
    next: () => Promise.resolve(new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } })),
  } as unknown as Context
}

function book(title: string, coverUrl: string | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

type Shared = { member: TestMember; token: string; bookId: string; title: string; readingTitle: string }

/**
 * A member with a name, one Book she finished with a Rating, one she is
 * reading, and her page on: what a visitor of the link sees. The reads are
 * dated into this year, because the page's figures are this year's.
 */
async function sharedPage(): Promise<Shared> {
  const member = await signUpMember()
  await createAuth(member.client).setName('Ada')
  const library = createLibrary(member.client)
  const entry = await library.addToLibrary(book('Piranesi', COVER))
  const added = entry.data!
  const today = new Date().toISOString().slice(0, 10)
  await sql(
    `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating, review)
     values ($1, $2::date - 10, $2::date, 'finished', 18, 'A house of statues and tides.')`,
    [added.id, today],
  )
  const reading = (await library.addToLibrary(book('The Left Hand of Darkness', null))).data!
  await library.startReading(reading.id, today)

  const { data, error } = await member.client.rpc('set_reading_page', { p_on: true })
  expect(error).toBeNull()
  return {
    member,
    token: (data as { token: string }).token,
    bookId: added.book.id,
    title: added.book.title,
    readingTitle: reading.book.title,
  }
}

const escapeForRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Answers the edge function's address itself and lets everything else reach the stack. */
function standInRenderer(answer: () => Response) {
  const real = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/functions/v1/reading-page-og')) return Promise.resolve(answer())
    return real(input as RequestInfo, init)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the page behind a link', () => {
  it('answers with the app shell, her name and the picture in the head', async () => {
    const { token, readingTitle } = await sharedPage()
    const response = await onRequest(context(`/r/${token}`))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('<meta property="og:title" content="Ada’s reading">')
    expect(html).toContain(`<title>Ada’s reading · Libellus</title>`)
    // What she is reading, then her year: both out of what the page publishes.
    expect(html).toMatch(
      new RegExp(`<meta property="og:description" content="Reading ${escapeForRegExp(readingTitle)} · 1 book in ${new Date().getFullYear()}">`),
    )
    expect(html).toMatch(new RegExp(`<meta property="og:image" content="${SITE}/r/${token}/og.png\\?v=[0-9a-f]{16}">`))
    expect(html).toContain('<meta property="og:image:width" content="1200">')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    // The app shell is still the app shell: the visitor gets the real page.
    expect(html).toContain('<div id="__nuxt">')

    // Hers to hand out, never a search result, and never kept by a cache.
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  it('names the Book and her Rating on a Book card', async () => {
    const { token, bookId, title } = await sharedPage()
    const response = await onRequest(context(`/r/${token}/book/${bookId}`))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain(`<meta property="og:title" content="${title} by Susanna Clarke">`)
    expect(html).toContain('Ada rated it 4½ stars')
    expect(html).toMatch(new RegExp(`<meta property="og:image" content="${SITE}/r/${token}/book/${bookId}/og.png\\?v=[0-9a-f]{16}">`))
  })

  it('is gone the moment she renews the link: the old address is a 404', async () => {
    const { member, token } = await sharedPage()
    await member.client.rpc('renew_reading_page_link')

    const response = await onRequest(context(`/r/${token}`))
    expect(response.status).toBe(404)
    const html = await response.text()
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    // Still the shell, so the app itself says there is no such page.
    expect(html).toContain('<div id="__nuxt">')
    expect(html).not.toContain('og:image')
  })

  it('is a 404 for an address under /r/ that is not shaped like a token', async () => {
    for (const path of ['/r/not-a-token', '/r/doesnotexist123', '/r/', '/r/AAAAAAAAAAAAAAAAAAAAAA/book/nope', '/r/x/y/z']) {
      const response = await onRequest(context(path))
      expect(response.status, path).toBe(404)
      const html = await response.text()
      // The shell all the same, so the app says there is no such page.
      expect(html).toContain('<div id="__nuxt">')
      expect(html).toContain('<title>Not found · Libellus</title>')
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    }
    // Also where there is no backend: the shape alone says it.
    const preview = await onRequest(context('/r/doesnotexist123', { env: { NUXT_PUBLIC_SUPABASE_URL: '', NUXT_PUBLIC_SUPABASE_ANON_KEY: '' } }))
    expect(preview.status).toBe(404)
    const image = await onRequest(context('/r/doesnotexist123/og.png'))
    expect(image.status).toBe(404)
    expect(image.headers.get('content-type')).not.toContain('html')
  })

  it('is a 404 for a token shaped right that nobody owns, page and card', async () => {
    const unknown = 'AAAAAAAAAAAAAAAAAAAAAA'
    const page = await onRequest(context(`/r/${unknown}`))
    expect(page.status).toBe(404)
    const card = await onRequest(context(`/r/${unknown}/book/00000000-0000-4000-8000-000000000000`))
    expect(card.status).toBe(404)
    expect((await card.text()).includes('og:image')).toBe(false)
  })

  it('keeps the shell with a 200 when the database cannot be asked, so the app retries', async () => {
    const { token, bookId } = await sharedPage()
    const real = globalThis.fetch
    for (const outage of [
      () => Promise.resolve(new Response('upstream down', { status: 503 })),
      () => Promise.resolve(new Response('{"message":"bad gateway"}', { status: 502 })),
      () => Promise.reject(new TypeError('network down')),
    ]) {
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        return url.includes('/rest/v1/rpc/') ? outage() : real(input as RequestInfo, init)
      })
      for (const path of [`/r/${token}`, `/r/${token}/book/${bookId}`]) {
        const response = await onRequest(context(path))
        expect(response.status, path).toBe(200)
        const html = await response.text()
        expect(html).toContain('<title>Libellus</title>')
        expect(html).not.toContain('og:image')
      }
    }
  })

  it('serves the shell untouched where there is no backend (a preview deployment)', async () => {
    const { token } = await sharedPage()
    const response = await onRequest(
      context(`/r/${token}`, { env: { NUXT_PUBLIC_SUPABASE_URL: '', NUXT_PUBLIC_SUPABASE_ANON_KEY: '' } }),
    )
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).not.toContain('og:image')
    expect(html).toContain('<title>Libellus</title>')
  })
})

describe('the picture of a link', () => {
  it('comes from the edge function, as a PNG kept for a day', async () => {
    const { token } = await sharedPage()
    standInRenderer(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }))

    const response = await onRequest(context(`/r/${token}/og.png`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toContain('max-age=86400')
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([137, 80, 78, 71]))
  })

  it('falls back to the Book\'s cover, or the app icon, while the renderer cannot draw', async () => {
    const { token, bookId } = await sharedPage()
    standInRenderer(() => new Response('no', { status: 500 }))

    const card = await onRequest(context(`/r/${token}/book/${bookId}/og.png`))
    expect(card.status).toBe(302)
    expect(card.headers.get('location')).toBe(COVER)

    const page = await onRequest(context(`/r/${token}/og.png`))
    expect(page.status).toBe(302)
    expect(page.headers.get('location')).toBe(`${SITE}/icon-512.png`)
  })

  it('stops at once when the link is renewed', async () => {
    const { member, token } = await sharedPage()
    await member.client.rpc('renew_reading_page_link')
    standInRenderer(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }))

    const response = await onRequest(context(`/r/${token}/og.png`))
    expect(response.status).toBe(404)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  it('is a 404 for a Book her page does not share', async () => {
    const { member, token } = await sharedPage()
    const other = await createLibrary(member.client).addToLibrary(book('Unshared', null))
    standInRenderer(() => new Response(PNG, { headers: { 'content-type': 'image/png' } }))

    const response = await onRequest(context(`/r/${token}/book/${other.data!.book.id}/og.png`))
    expect(response.status).toBe(404)
  })
})
