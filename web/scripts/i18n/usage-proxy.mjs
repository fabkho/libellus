// A pass-through to the Gemini API that adds up what a translate run costs (docs/i18n/README.md).
//
//   node scripts/i18n/usage-proxy.mjs [port] [usage.jsonl]
//
// the-i18n-kit prints no token counts. Point it here (`--baseUrl http://127.0.0.1:<port>`) and every
// answer's `usageMetadata` is appended to the file as one line: model, prompt tokens, answer tokens,
// thinking tokens. The request's API key header is passed on to Google and never logged or stored.
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 3104)
const out = process.argv[3] ?? 'usage.jsonl'

createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com${req.url}`, {
      method: req.method,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': req.headers['x-goog-api-key'] ?? '' },
      body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks),
    })
    const text = await upstream.text()
    try {
      const body = JSON.parse(text)
      const u = body.usageMetadata
      if (u) {
        const model = decodeURIComponent(req.url.split('/models/')[1]?.split(':')[0] ?? '')
        appendFileSync(out, `${JSON.stringify({ model, status: upstream.status, prompt: u.promptTokenCount ?? 0, answer: u.candidatesTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0, total: u.totalTokenCount ?? 0 })}\n`)
      }
    } catch { /* not JSON: pass it on */ }
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
    res.end(text)
  } catch (error) {
    res.writeHead(502)
    res.end(JSON.stringify({ error: { message: String(error) } }))
  }
}).listen(port, '127.0.0.1', () => console.error(`usage proxy on http://127.0.0.1:${port} → ${out}`))
