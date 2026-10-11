// A pass-through to the Gemini API that adds up what a translate run costs (docs/i18n/README.md).
//
//   node scripts/i18n/usage-proxy.mjs [port] [usage.jsonl]
//
// the-i18n-kit prints no token counts. Point it here (`--baseUrl http://127.0.0.1:<port>`) and every
// answer's `usageMetadata` is appended to the file as one line: model, prompt tokens, answer tokens,
// thinking tokens. The request's API key header is passed on to Google and never logged or stored.
// Only the allow-listed Gemini model paths below are forwarded, always to the fixed host: the request picks no host, no scheme and no other method.
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 3104)
const out = process.argv[3] ?? 'usage.jsonl'

/** The only upstream this proxy ever talks to: the host is fixed here, never taken from the request. */
const UPSTREAM = 'https://generativelanguage.googleapis.com'
/** The Gemini methods the-i18n-kit calls. Everything else is refused before a request is built. */
const ALLOWED_PATH = /^\/v1(?:beta|alpha)?\/models\/[\w.-]+:(?:generateContent|streamGenerateContent|countTokens)$/

createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    const url = new URL(req.url ?? '/', UPSTREAM)
    if (url.origin !== UPSTREAM || !ALLOWED_PATH.test(url.pathname)) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'usage proxy: unknown endpoint' } }))
      return
    }
    const upstream = await fetch(url, {
      method: req.method,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': req.headers['x-goog-api-key'] ?? '' },
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks),
      redirect: 'error',
    })
    const text = await upstream.text()
    try {
      const body = JSON.parse(text)
      const u = body.usageMetadata
      if (u) {
        const model = decodeURIComponent(url.pathname.split('/models/')[1]?.split(':')[0] ?? '')
        appendFileSync(out, `${JSON.stringify({ model, status: upstream.status, prompt: u.promptTokenCount ?? 0, answer: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0, total: u.totalTokenCount ?? 0 })}\n`)
      }
    } catch { /* not JSON: pass it on */ }
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
    res.end(text)
  } catch {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'usage proxy: the upstream request failed' } }))
  }
}).listen(port, '127.0.0.1', () => console.error(`usage proxy on http://127.0.0.1:${port} → ${out}`))
