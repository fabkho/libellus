// The flows' app served the way Cloudflare Pages serves the real one (docs/HOSTING.md): the static
// build in .output-e2e/public (e2e/build.ts), its `_headers` and `_redirects`, a folder's
// index.html with Pages' trailing slash, the nearest 404.html, else the SPA fallback (index.html,
// 200), and the Pages Functions in web/functions on the addresses Pages gives them (`/r/*`,
// `POST /share`). playwright.config.ts starts it; nothing else does.
//
//   node e2e/serve.mjs <port>
//
// Small on purpose: what the app needs of Pages, not all of Pages. The Functions get the
// environment this process has (the webServer's: NUXT_PUBLIC_SUPABASE_URL and the anon key) and
// `ASSETS` for the static files.
import { createServer } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const port = Number(process.argv[2] ?? 4327)
// LIBELLUS_SERVE_ROOT points it at another build (perf/serve.mjs serves the production one).
const root = process.env.LIBELLUS_SERVE_ROOT
  ? join(process.env.LIBELLUS_SERVE_ROOT, '/')
  : fileURLToPath(new URL('../.output-e2e/public/', import.meta.url))
const functionsDir = fileURLToPath(new URL('../functions/', import.meta.url))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
}

try {
  await stat(join(root, 'index.html'))
} catch {
  console.error(`No build in ${root}: run \`pnpm e2e:build\` (or the flows without LIBELLUS_E2E_PREBUILT).`)
  process.exit(1)
}

// ------------------------------------------------------------ _headers, _redirects

/** A Pages path pattern (`/*` splat, `:name` placeholder) as a RegExp. Absolute URLs (another host) never match here. */
const pattern = (path) =>
  new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:\w+/g, '[^/]+')}$`)

async function lines(name) {
  try {
    return (await readFile(join(root, name), 'utf8')).split('\n').map((line) => line.replace(/\s+#.*$|^#.*$/, '')).filter((line) => line.trim())
  } catch {
    return []
  }
}

const headerRules = []
for (const line of await lines('_headers')) {
  if (!/^\s/.test(line)) headerRules.push({ match: line.startsWith('/') ? pattern(line.trim()) : null, headers: [] })
  else if (headerRules.length) {
    const [name, ...value] = line.trim().split(':')
    headerRules.at(-1).headers.push([name.trim(), value.join(':').trim()])
  }
}
const redirectRules = (await lines('_redirects')).map((line) => {
  const [from, to, status] = line.trim().split(/\s+/)
  return { match: pattern(from), to, status: Number(status ?? 302) }
})

/** `_headers`' rules for the address on top of the answer's own: several matching rules join their values, and they win over Pages' defaults. */
/**
 * The site's policy names the production backend (`*.supabase.co`); the flows' backend is the local
 * stack, so its origin is added where the backend is (connect-src: the API; img-src: Storage's
 * pictures), as production's own policy has its own.
 */
const STACK = process.env.NUXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NUXT_PUBLIC_SUPABASE_URL).origin : null
const withStack = (policy) =>
  STACK ? policy.replace(/\b(connect-src|img-src)\b([^;]*)/g, (_, directive, sources) => `${directive}${sources} ${STACK}`) : policy

function withHeaders(path, headers) {
  const set = new Map()
  for (const rule of headerRules) {
    if (!rule.match?.test(path)) continue
    for (const [name, value] of rule.headers) {
      const key = name.toLowerCase()
      set.set(key, set.has(key) ? `${set.get(key)}, ${value}` : value)
    }
  }
  for (const [name, value] of set) headers.set(name, value)
  return headers
}

// ------------------------------------------------------------ static files

const isFile = async (file) => {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

/** The build's stand-ins for the stack (e2e/build.ts, STACK_STAND_INS), and what this run's stack is. */
const STAND_INS = [
  ['http://libellus-e2e-stack.invalid', process.env.NUXT_PUBLIC_SUPABASE_URL],
  ['libellus-e2e-anon-key', process.env.NUXT_PUBLIC_SUPABASE_ANON_KEY],
]

async function fileResponse(file, status = 200) {
  const headers = new Headers({
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    // Pages' default; `_headers` adds the long-lived rules.
    'cache-control': 'public, max-age=0, must-revalidate',
  })
  let body = await readFile(file)
  // The page's runtime configuration (Nuxt writes it into the HTML): this run's stack.
  if (extname(file) === '.html') {
    let html = body.toString('utf8')
    for (const [standIn, value] of STAND_INS) if (value) html = html.replaceAll(standIn, value)
    body = html
  }
  return new Response(body, { status, headers })
}

/** A static answer, as Pages gives it: without `_headers` (applied by `serve`, not for a Function's own answer). */
async function asset(pathname, search = '') {
  const path = normalize(decodeURIComponent(pathname))
  const file = join(root, path)
  if (relative(root, file).startsWith('..')) return new Response('Not found', { status: 404 })
  if (await isFile(file)) return fileResponse(file)
  // A folder: its index.html, at the address with a trailing slash (Pages redirects to it).
  if (await isFile(join(file, 'index.html'))) {
    if (!path.endsWith('/')) return new Response(null, { status: 308, headers: { location: `${pathname}/${search}` } })
    return fileResponse(join(file, 'index.html'))
  }
  if (await isFile(`${file}.html`)) return fileResponse(`${file}.html`)
  // The nearest 404.html up the tree; with none, the SPA fallback.
  for (let dir = path.endsWith('/') ? path : path.slice(0, path.lastIndexOf('/') + 1); dir.startsWith('/'); dir = dir.slice(0, dir.slice(0, -1).lastIndexOf('/') + 1)) {
    if (await isFile(join(root, dir, '404.html'))) return fileResponse(join(root, dir, '404.html'), 404)
    if (dir === '/') break
  }
  return fileResponse(join(root, 'index.html'))
}

// ------------------------------------------------------------ Pages Functions

/** web/functions as Pages routes it: `[[path]]` takes the rest of the address, `[name]` one part, `index` the folder. */
async function functionRoutes(dir, prefix = '') {
  const routes = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) routes.push(...(await functionRoutes(join(dir, entry.name), `${prefix}/${entry.name}`)))
    else if (/\.(m?js|ts)$/.test(entry.name)) {
      const name = entry.name.replace(/\.(m?js|ts)$/, '')
      const part = name === 'index' ? '' : name.startsWith('[[') ? '/(?<rest>.*)' : name.startsWith('[') ? '/(?<one>[^/]+)' : `/${name}`
      routes.push({ match: new RegExp(`^${prefix}${part}/?$`), file: join(dir, entry.name), catchAll: name.startsWith('[[') })
    }
  }
  // Specific before catch-all.
  return routes.sort((a, b) => Number(a.catchAll) - Number(b.catchAll))
}
const routes = await functionRoutes(functionsDir)

async function runFunction(request, url) {
  for (const route of routes) {
    const found = url.pathname.match(route.match)
    if (!found) continue
    const params = { ...found.groups }
    const module = await import(pathToFileURL(route.file).href)
    const method = request.method[0] + request.method.slice(1).toLowerCase()
    const handler = module[`onRequest${method}`] ?? module.onRequest
    if (!handler) continue
    const next = async () => serveStatic(url)
    const env = { ...process.env, ASSETS: { fetch: async (input) => asset(new URL(input instanceof Request ? input.url : input, url).pathname) } }
    return handler({ request, env, params, next, data: {}, waitUntil: () => {}, functionPath: url.pathname })
  }
  return null
}

async function serveStatic(url) {
  for (const rule of redirectRules) {
    if (rule.match.test(url.pathname)) return new Response(null, { status: rule.status, headers: { location: rule.to } })
  }
  const response = await asset(url.pathname, url.search)
  return new Response(response.body, { status: response.status, headers: withHeaders(url.pathname, new Headers(response.headers)) })
}

// ------------------------------------------------------------ the server

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(await Array.fromAsync(req))
    const request = new Request(url, { method: req.method, headers: req.headers, body })
    const response = (await runFunction(request, url)) ?? (await serveStatic(url))
    const headers = {}
    // The static files' policy and the /r/ Function's own alike.
    response.headers.forEach((value, name) => (headers[name] = /^content-security-policy/.test(name) ? withStack(value) : value))
    res.writeHead(response.status, headers)
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error(error)
    res.writeHead(500).end(String(error))
  }
})
// Node closes an idle kept-alive connection after 5 s, and a browser that sends its next request
// down it in that moment sees it reset; a page load then waits for a file that never comes. The
// browser closes its connections itself well before this.
server.keepAliveTimeout = 120_000
server.headersTimeout = 125_000
server.listen(port, () => console.log(`Serving ${root.split(sep).slice(-3).join('/')} like Pages on http://localhost:${port}`))
