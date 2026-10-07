# Hosting

Libellus is static files on **Cloudflare Pages**, project `libellus`, served at
https://libellus.fabkho.dev. Supabase (eu-central-1) is the backend; the owner's shelf reads
its library file from `books.fabkho.dev` (R2 bucket `portfolio-books`, published by Regal's
workflow, docs/OWNER.md "Feeding Regal"). The database is backed up every night into the private R2
bucket `libellus-backups` (docs/OPERATIONS.md, "Backups"). This page is what is set up outside the repository and
what the repository decides itself.

## Builds and deployments

Pages builds from GitHub (fabkho/libellus): a push to `main` is production, every other branch
a preview at `<branch>.libellus-3q1.pages.dev` (and `<deployment id>.libellus-3q1.pages.dev`).

| Setting | Value |
| --- | --- |
| Root directory | `web` |
| Build command | `pnpm generate` (`nuxt generate`; on Pages, Nitro picks its `cloudflare-pages-static` preset by itself) |
| Output directory | `dist` |
| `NODE_VERSION` | `24` (production and preview) |
| `LIBELLUS_REGAL` | `1`: build with the Regal layer (`regal.config.ts`; without it the shelf is left out). Production and preview. |
| `GIGET_AUTH` (secret) | A GitHub token that can read fabkho/regal: where the Regal layer comes from. Production and preview. |
| `NUXT_PUBLIC_REGAL_LIBRARY_SRC` | `https://books.fabkho.dev/v2/library.json`, the library file the shelf shows (the build stops without it when `LIBELLUS_REGAL=1`). Production and preview. |
| `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY`, `NUXT_PUBLIC_SHELF_OWNER_ID` | Production only. Previews have no backend: they show the signed-out screens and cannot sign in, so a branch never touches production data. |

A deploy is atomic and a rollback is one click (Workers & Pages → libellus → Deployments →
⋯ → Rollback). The same commit can be built again with "Retry deployment", which is also how
a change to the project's settings (below) reaches the live site without a commit.

## The two Pages Functions

Pages builds `web/functions/` beside the output by itself (no setting), and generates the
`_routes.json` that decides which addresses invoke a Function from the files it finds there: with
the two below, `include` is `["/share", "/r/*"]` and everything else stays a free static request.
Nitro's `cloudflare-pages-static` preset writes no `_routes.json` of its own, so nothing overrides
that (checked with `npx wrangler pages functions build --output-routes-path`).

**`web/functions/share.js`** — a share to the installed app is a `POST /share` (the manifest's share
target, #91 and #131) that the service worker answers on the device. Only when it reaches Pages
instead (the very first share right after installing, before the service worker took over) does the
function answer: a 303 to `/share?title=&text=&url=`, plus `ebooks=missed` when files were shared,
so the app asks for the share again. It keeps nothing; a `GET /share` is not handled by it and gets
the static page.

**`web/functions/r/[[path]].js`** — the link previews of a shared reading page (#171). The app
renders `/r/<token>` and `/r/<token>/book/<id>` in the browser, which is enough for a visitor but
not for the crawlers that make a preview of a pasted link (WhatsApp, Signal, iMessage, Mastodon,
Slack): they read the HTML and run no JavaScript. So the function answers those two addresses with
the same app shell (`ASSETS.fetch('/')`) and writes into its `<head>`, by string replacement: the
title, `og:title`, `og:description` (what she is reading, her year, her Rating, an excerpt of a
review she shared), `og:url`, `og:image` and its size, `twitter:card`, and `noindex, nofollow`.

- It reads what it says from the two public database functions `public_reading_page` and
  `public_book_card` with the **anon key** — exactly what the app reads — out of
  `NUXT_PUBLIC_SUPABASE_URL` and `NUXT_PUBLIC_SUPABASE_ANON_KEY` (production only; a preview
  deployment has neither, so the shell goes out untouched). `null` from the database (the page is
  off, the link was renewed, the Book is not published) is a **404**, with the shell all the same,
  so the app shows its own "no such page" screen.
- `/r/<token>/og.png` and `/r/<token>/book/<id>/og.png` are the picture. The token is checked
  against the database first, so a renewed link stops serving its image at once; then the image
  comes from the `reading-page-og` edge function (below) and is kept in `caches.default` under an
  address that carries a short hash of the published data (`?v=…`), so a changed page gets a new
  one. A day of `max-age`, `immutable`. While the renderer is not deployed or fails, the preview
  falls back to the Book's own cover (a card) or `/icon-512.png`.
- Headers: `X-Robots-Tag: noindex, nofollow` — a link she hands out is never a search result — and
  `Cache-Control: no-store` on the HTML: it is one member's page, and she can switch it off between
  two views of the same address, so neither a CDN nor the service worker may keep it.
- `web/public/_headers` does **not** reach a Function's response in production (Cloudflare's
  documentation says so for every rule in the file, and `ASSETS.fetch` hands back the asset without
  them too); `npx wrangler pages dev` does apply them locally, which hides it. The function
  therefore sets the security headers of the `/*` rule itself where the shell's response does not
  already carry them (`SITE_HEADERS` in the file; keep it in step with `_headers`).

Everything else stays static, and only `/share` and `/r/*` invoke a Function.

## The reading page's Open Graph image

`supabase/functions/reading-page-og/` (its README has the details) draws the 1200×630 PNG behind
`…/og.png`: satori lays the image out, resvg rasterises it, the fonts are latin subsets bundled
with the function, and the covers are fetched with a short timeout. It asks the same two public
database functions with the anon key and answers 404 for a token that leads nowhere.

It is a Supabase edge function and not the Pages Function in front of it because a render costs
about a hundred milliseconds of CPU: Pages Functions on the Workers free plan get roughly ten
milliseconds per request, while a Supabase edge function may take two seconds. The stack already
runs Deno edge functions with their Deno tests in CI, and with the image cached at the edge for a
day the render happens once per link and version. It is deployed by hand like the others:
`supabase functions deploy reading-page-og` (docs/OPERATIONS.md, docs/SELF_HOSTING.md).

## Addresses

- `libellus.fabkho.dev`: the Pages project's custom domain, a proxied CNAME to
  `libellus-3q1.pages.dev` in the `fabkho.dev` zone. Zone settings (TLS, caching) apply to it.
- `libellus-3q1.pages.dev`: production's Pages address. It stays reachable and is **not**
  redirected to the custom domain (the owner's decision); it answers with
  `X-Robots-Tag: noindex` instead (`web/public/_headers`). Preview addresses get `noindex` from
  Pages itself.

## Deep links

An address with no file behind it (`/book/<id>`, `/collections/<id>`, `/profile/<year>`, any
unknown path) is answered with `index.html`, the app shell, **status 200**, and the app routes in
the browser (an unknown path ends on the app's own not-found screen). That is Pages' SPA fallback,
which Pages uses when the output has no top-level `404.html`, so the build must not have one:
`nuxt.config.ts` sets `nitro.prerender.ignore: ['/404.html']` (Nuxt adds `/200.html` and
`/404.html` to every static build; with the file gone Nitro also stops writing its
`/* /404.html 404` line to `_redirects`, which Pages rejected anyway: rewrites with a code other
than 200 are not supported). Before this, the shell came as `404.html` with status 404: right in
the browser, wrong for link previews, crawlers and anything that reads the status.

A file under `/_nuxt/` that is gone (a lazy chunk after a deploy replaced it) must stay a real
404, not the shell with 200. Pages looks for the closest `404.html` up the path before it falls
back to the SPA shell, so `web/public/_nuxt/404.html` (a line of text) answers every miss under
`/_nuxt/` with status 404 and `Cache-Control: no-store`, while the rest of the site keeps the
SPA fallback. The service worker never precaches it (`globIgnores` has `**/404.html`). Do not
add a `404.html` anywhere else: a top-level one switches the fallback off again.

A browser that asks for a lazy chunk that is gone gets the error either way (404 or HTML in a
script's place): Vite's loader fires `vite:preloadError`, Nuxt turns it into `app:chunkError` and
reloads on the next navigation, and the error log files it as kind `chunk`
(`app/plugins/error-log.client.ts`; `isChunkError` knows Safari's and Firefox's MIME-type
wording too, for a host that answers a gone chunk with the shell).

`/r/<token>` is the one address that answers 404 on purpose while still sending the shell: the
Function above says so when the link leads nowhere, and the app shows its not-found screen.

After a change here, check a deployment (preview or production) with
`curl -s -o /dev/null -w '%{http_code}\n'` on `/book/x` (200), `/nope` (200),
`/_nuxt/missing.js` (404) and `/sw.js` (200), or locally `pnpm build` with
`NITRO_PRESET=cloudflare-pages-static`, then `npx wrangler pages dev dist`. With the reading page's
Function, also `/r/<22 characters nobody owns>` (404) and `/r/nonsense` (200, static).

## Response headers

`web/public/_headers` holds the headers the app decides (the comments say why), and the build
appends Nitro's: `/_nuxt/*` and `/_fonts/*` immutable for a year (their names carry a hash).
On top of Pages' defaults (`X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Access-Control-Allow-Origin: *`):

- `Strict-Transport-Security`, `X-Frame-Options: DENY`, a `Permissions-Policy` that allows only
  the camera (the barcode scanner), and only to Libellus.
- `Content-Security-Policy-Report-Only`: violations show in the browser console, nothing is
  blocked. A new host the app talks to (a search source, a cover host read with CORS) goes into
  `connect-src` first. To enforce it, rename the header once a while of real use reports
  nothing.
- `Cache-Control: no-cache` on `sw.js`, `sw-sync.js` and `manifest.webmanifest`.

These rules reach **static answers only**: a Pages Function's response goes out as the Function
wrote it, so `web/functions/r/[[path]].js` sets them itself (above). `npx wrangler pages dev` does
apply `_headers` to a Function's response, so the gap only shows in production — a header added to
the `/*` rule has to be added to the Function too.

To check a change before it ships, build with `CF_PAGES=1 pnpm generate` (writes `dist/` with the
merged `_headers`) and serve it with `npx wrangler pages dev dist`, which applies `_headers` the
way Pages does. Headers a preview deployment sends can be read with `curl -sI`.

The zone's **Browser Cache TTL** (4 hours) raises a shorter `max-age` on the zone's cacheable file
types (scripts, images) on `libellus.fabkho.dev` only: `sw-sync.js` and the icons arrive there
with `max-age=14400`.

## Web Analytics

Cloudflare Web Analytics measures page loads and Core Web Vitals without cookies or any
identifier stored on the device (no consent banner needed). It is switched on in the Pages
project (Metrics → Web Analytics; via the API: `build_config.web_analytics_tag` and
`web_analytics_token` of the project), for the site `libellus.fabkho.dev`: Pages adds the beacon
(`static.cloudflareinsights.com/beacon.min.js`, reporting to `cloudflareinsights.com`) to every HTML
response of every deployment built after it was switched on, previews and the pages.dev address
included, so the dashboard's host filter separates `libellus.fabkho.dev` from the rest. Route
changes inside the app count as page views. Nothing in the repository loads it; the CSP above
allows it. A browser with an ad blocker sends nothing.

The numbers: dashboard → Analytics & Logs → Web Analytics → libellus.fabkho.dev, or the GraphQL
Analytics API (`rumPageloadEventsAdaptiveGroups`, `rumPerformanceEventsAdaptiveGroups`, filtered
by the site tag). To switch it off: Metrics → Web Analytics → Disable, then retry the latest
production deployment.
