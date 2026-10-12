// Cloudflare Pages Function (docs/HOSTING.md): the web app manifest, in German for a German browser
// (German group B of #257). The manifest is built once (nuxt.config.ts, `pwa.manifest`, English) and has no
// per-language members, but the browser asks for it with its own `Accept-Language` at install and at every
// update check. So: the built file, untouched, for everyone; for a browser whose first language the app
// speaks is German, the same file with `lang`, `description` and the shortcuts' names in German
// (app/utils/manifestText.ts). `name` and `short_name` are the brand and stay. Any trouble reading the
// file and the browser gets exactly what the static asset would have given it.
import { germanManifest, prefersGerman } from '../app/utils/manifestText.ts'

export async function onRequestGet({ request, env }) {
  const asset = await env.ASSETS.fetch(request)
  const headers = new Headers(asset.headers)
  // The two answers differ by language: a cache must not hand one to the other. `_headers` does not reach
  // an ASSETS.fetch answer, so the file's own rule (no-cache) is set here as well.
  headers.set('Vary', 'Accept-Language')
  headers.set('Cache-Control', 'no-cache')
  if (!asset.ok || !prefersGerman(request.headers.get('Accept-Language'))) return new Response(asset.body, { status: asset.status, headers })
  try {
    const manifest = await asset.clone().json()
    headers.set('Content-Type', 'application/manifest+json')
    headers.delete('Content-Length')
    return new Response(JSON.stringify(germanManifest(manifest)), { status: 200, headers })
  } catch {
    return new Response(asset.body, { status: asset.status, headers })
  }
}
