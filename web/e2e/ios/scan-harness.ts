/**
 * Serves the static build (`pnpm generate`, `.output/public`) to a device that
 * cannot be driven by Playwright: the iOS Simulator's Safari (docs/TESTING.md,
 * barcode scanner). Not part of CI.
 *
 *   pnpm tsx e2e/ios/scan-harness.ts --port 3102
 *
 * It signs a fresh test member up on the local stack and plants her session in
 * the page's localStorage (the Simulator has no way to type a mailed code), then
 * serves the app as it is built. The page is the real app; only two things are
 * added to the HTML, a script that
 *  - in mode `still`, stands in for the camera, which the Simulator does not have:
 *    `getUserMedia` answers with a canvas stream that shows a picture of a book's
 *    barcode (tests/fixtures/barcode), so the real <video>, the real WebAssembly
 *    decoder, the real loop and the real lookup run on frames. Mode `real`
 *    leaves the browser's own `getUserMedia` alone (the Simulator has no camera: it
 *    never answers, so the view stays on "Allow the camera");
 *  - reports what the page does to `/__log` (printed here), and, with
 *    `?auto=scan`, opens the search and taps the camera button once the app is up.
 * The mode is chosen in the address, `?mode=still|real|none|denied` (`none` and `denied`
 * make `getUserMedia` fail the way a phone without a camera, or one where the member said
 * no, does): the app is served from the service worker's copy after the first load, so the
 * server cannot decide it.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { parseArgs } from 'node:util'
import { signUpMember } from '../../tests/support/member'
import { memoryStorage } from '../../tests/support/stack'

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '3102' },
    root: { type: 'string', default: '.output/public' },
    picture: { type: 'string', default: 'tests/fixtures/barcode/frame-9783641264864.jpg' },
  },
})
process.env.LIBELLUS_TEST_RUN ??= 'ios'

const storage = memoryStorage()
const member = await signUpMember(storage)
const session: Record<string, string> = {}
for (const key of ['sb-127-auth-token', 'sb-localhost-auth-token']) {
  const value = await storage.getItem(key)
  if (value) session[key] = value
}
if (!Object.keys(session).length) throw new Error('No session was stored: the client used another storage key than expected')
console.log('member', member.email)

const mode = 'still'
const picture = readFileSync(args.picture!)

const script = () => `
(() => {
  const log = (m) => fetch('/__log?m=' + encodeURIComponent(m)).catch(() => {});
  const session = ${JSON.stringify(session)};
  for (const [k, v] of Object.entries(session)) if (!localStorage.getItem(k)) localStorage.setItem(k, v);
  // The mode comes from the address (?mode=...): after the first load the app is served from the service worker's copy.
  const mode = new URLSearchParams(location.search).get('mode') || ${JSON.stringify(mode)};
  log('page ' + location.pathname + ' mode=' + mode + ' BarcodeDetector=' + ('BarcodeDetector' in window) + ' getUserMedia=' + Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) + ' vibrate=' + (typeof navigator.vibrate) + ' ua=' + navigator.userAgent);
  if ((mode === 'none' || mode === 'denied') && navigator.mediaDevices) {
    const fail = async () => { throw new DOMException(mode === 'denied' ? 'Permission denied' : 'Requested device not found', mode === 'denied' ? 'NotAllowedError' : 'NotFoundError'); };
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { value: fail, configurable: true, writable: true });
  }
  if (mode === 'still' && navigator.mediaDevices) {
    const image = new Image(); image.src = '/__picture.jpg';
    const stand = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const c = canvas.getContext('2d');
      const paint = setInterval(() => { if (image.complete) c.drawImage(image, 0, 0, 640, 480); }, 40);
      const stream = canvas.captureStream(25);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(paint); log('camera track stopped'); stop(); };
      log('camera: stand-in stream opened');
      return stream;
    };
    Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices), 'getUserMedia', { value: stand, configurable: true, writable: true });
  }
  let last = '';
  setInterval(() => {
    const overlay = document.querySelector('[data-testid="scan.overlay"]');
    const state = location.pathname + ' | ' + (overlay ? overlay.innerText.replace(/\\s+/g, ' ').slice(0, 120) : 'no scanner');
    if (state !== last) { last = state; log(state); }
  }, 500);
  if (new URLSearchParams(location.search).get('auto') === 'scan') {
    const until = (sel) => new Promise((resolve) => { const t = setInterval(() => { const e = document.querySelector(sel); if (e) { clearInterval(t); resolve(e); } }, 200); });
    (async () => {
      (await until('[data-testid="shell.tab.search"]')).click();
      log('search opened');
      (await until('[data-testid="search.scan"]')).click();
      log('camera button tapped');
    })();
  }
})();`

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg',
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname === '/__log') {
    console.log('PAGE', url.searchParams.get('m'))
    return void response.end('ok')
  }
  if (url.pathname === '/__picture.jpg') return void response.writeHead(200, { 'content-type': 'image/jpeg' }).end(picture)
  let file = join(args.root!, normalize(url.pathname))
  if (!existsSync(file) || statSync(file).isDirectory()) file = existsSync(join(file, 'index.html')) && statSync(file).isDirectory() ? join(file, 'index.html') : join(args.root!, 'index.html')
  const type = TYPES[extname(file)] ?? 'application/octet-stream'
  let body: Buffer | string = readFileSync(file)
  if (type.startsWith('text/html')) body = body.toString().replace('<head>', `<head><script>${script()}</script>`)
  response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body)
}).listen(Number(args.port), () => console.log(`serving ${args.root} on http://localhost:${args.port}`))
