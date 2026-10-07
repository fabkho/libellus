/**
 * `reading-page-og`: the link-preview image of a reading page or of one of its
 * Book cards (issue #171).
 *
 *   GET /functions/v1/reading-page-og?token=<token>              the page
 *   GET /functions/v1/reading-page-og?token=<token>&book=<uuid>  one Book's card
 *
 *   200 image/png, 1200×630, cached for a day
 *   404 the token is unknown (off, renewed) or the Book is not published
 *   502 the database could not be asked
 *
 * It asks the same two public functions the page itself reads
 * (`public_reading_page`, `public_book_card`) with the anon key, so a revoked
 * link stops producing images at once and nothing beyond what she published
 * can reach an image. Everything it talks to is injected (`fetch`), so the
 * tests render both images without a network.
 */
import { type PublicBookCard, type PublicReadingPage, TOKEN, UUID } from './page.ts'
import { type FetchLike, renderCard, renderPage, type RenderDeps } from './render.ts'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
}

/** A day, the same age the Pages Function in front of this keeps the image. */
export const MAX_AGE_SECONDS = 86_400

export type HandlerDeps = {
  supabaseUrl: string
  anonKey: string
  /** Used for both the database and the covers; the tests answer both. */
  fetch?: FetchLike
  coverTimeoutMs?: number
  log?: (message: string) => void
}

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8' } })
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init))
  const log = deps.log ?? ((message: string) => console.error(message))
  const render: RenderDeps = { fetch: fetchImpl, coverTimeoutMs: deps.coverTimeoutMs }

  /** One of the two public functions, with the anon key, as a visitor would. */
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
    const response = await fetchImpl(`${deps.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: deps.anonKey,
        authorization: `Bearer ${deps.anonKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    if (!response.ok) throw new Error(`${name} answered ${response.status}`)
    return (await response.json()) as T | null
  }

  return async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
    if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'method_not_allowed')

    const params = new URL(request.url).searchParams
    const token = params.get('token') ?? ''
    const book = params.get('book')
    // A token or a Book id that cannot exist is answered like one that does not:
    // a link preview never learns the difference.
    if (!TOKEN.test(token) || (book !== null && !UUID.test(book))) return text(404, 'not_found')

    let png: Uint8Array
    try {
      if (book) {
        const card = await rpc<PublicBookCard>('public_book_card', { p_token: token, p_book: book })
        if (!card) return text(404, 'not_found')
        png = await renderCard(card, render)
      } else {
        const page = await rpc<PublicReadingPage>('public_reading_page', { p_token: token })
        if (!page) return text(404, 'not_found')
        png = await renderPage(page, render)
      }
    } catch (error) {
      log(`reading-page-og: ${book ? `card ${book}` : 'page'} failed: ${error}`)
      return text(502, 'render_failed')
    }

    return new Response(request.method === 'HEAD' ? null : (png as unknown as BodyInit), {
      headers: {
        ...CORS,
        'content-type': 'image/png',
        'cache-control': `public, max-age=${MAX_AGE_SECONDS}`,
      },
    })
  }
}
