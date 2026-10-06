// Spike server: static files + /__log (client events → stdout and logs file). PORT=3126
import { createServer } from 'node:http'
import { readFile, appendFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' }
const LOG = process.env.LOG ?? '/tmp/ebook-spike/logs/client.log'

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/__log') {
    let body = ''
    for await (const chunk of req) body += chunk
    const line = `${new Date().toISOString()} ${body}\n`
    process.stdout.write(line)
    appendFile(LOG, line).catch(() => {})
    res.writeHead(204).end()
    return
  }
  // Dev only: serve the public-domain fixtures to the desktop run, which fills OPFS with them.
  if (url.pathname.startsWith('/__fixtures/')) {
    try {
      const file = await readFile(join(process.env.FIXTURES ?? '/tmp/ebook-spike/fixtures', normalize(url.pathname.slice(12))))
      res.writeHead(200, { 'Content-Type': 'application/epub+zip' }).end(file)
    } catch { res.writeHead(404).end() }
    return
  }
  // The Service Worker must not be served from cache while the spike changes.
  const headers = { 'Cache-Control': 'no-store' }
  let path = url.pathname === '/' || url.pathname === '/share' ? '/index.html' : url.pathname
  // POST to a page (share target without a Service Worker): the SW should have answered; say so.
  if (req.method === 'POST') {
    let size = 0
    for await (const chunk of req) size += chunk.length
    const line = `${new Date().toISOString()} SERVER got POST ${url.pathname} (${size} bytes, no service worker answered)\n`
    process.stdout.write(line)
    appendFile(LOG, line).catch(() => {})
    res.writeHead(200, { 'Content-Type': 'text/plain', ...headers }).end('POST reached the server: the service worker did not handle it\n')
    return
  }
  try {
    const file = await readFile(join(root, normalize(path)))
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', ...headers }).end(file)
  } catch {
    res.writeHead(404, headers).end('not found')
  }
}).listen(Number(process.env.PORT ?? 3126), '0.0.0.0', () => console.log('spike on', process.env.PORT ?? 3126))
