# Hosting

BetterReads is static files on **Cloudflare Pages**, project `libellus`, served at
https://libellus.fabkho.dev. Supabase (eu-central-1) is the backend; the owner's shelf reads
its library file from `books.fabkho.dev` (R2 bucket `portfolio-books`, published by Regal's
workflow, docs/OWNER.md "Feeding Regal"). The database is backed up every night into the private R2
bucket `libellus-backups` (docs/OPERATIONS.md, "Backups"). This page is what is set up outside the repository and
what the repository decides itself.

## Builds and deployments

Pages builds from GitHub (fabkho/libellus). Its **production branch is `production`**, which only the
release workflow moves: merging the release pull request tags `vX.Y.Z`, pushes the migrations and the
edge functions, then points `production` at the tag (docs/OPERATIONS.md, "Releases"; a manual run of
the workflow deploys an older tag again, which is the rollback). Every other branch, `main` included,
is a preview at `<branch>.libellus-3q1.pages.dev` (and `<deployment id>.libellus-3q1.pages.dev`):
`main.libellus-3q1.pages.dev` is what the next release will be (signed out only, like every preview:
the Supabase variables below are set for production alone).

Until the one-time switch (Settings → Builds → Branch control → Production branch: `production`,
after the branch exists; docs/OPERATIONS.md, "The first release") a push to `main` is still production.

| Setting | Value |
| --- | --- |
| Production branch | `production` (moved by `.github/workflows/release.yml` only) |
| Root directory | `web` |
| Build command | `pnpm generate` (`nuxt generate`; on Pages, Nitro picks its `cloudflare-pages-static` preset by itself). It reads `../version.txt` and `../CHANGELOG.md` for the app's version and What's new. |
| Output directory | `dist` |
| `NODE_VERSION` | `24` (production and preview) |
| `LIBELLUS_REGAL` | `1`: build with the Regal layer (`regal.config.ts`; without it the shelf is left out). Production and preview. |
| `GIGET_AUTH` (secret) | A GitHub token that can read fabkho/regal: where the Regal layer comes from. Production and preview. |
| `NUXT_PUBLIC_REGAL_LIBRARY_SRC` | `https://books.fabkho.dev/v2/library.json`, the library file the shelf shows (the build stops without it when `LIBELLUS_REGAL=1`). Production and preview. |
| `NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_ANON_KEY`, `NUXT_PUBLIC_SHELF_OWNER_ID` | Production only. Previews have no backend: they show the signed-out screens and cannot sign in, so a branch never touches production data. |

A deploy is atomic and a rollback is one click (Workers & Pages → libellus → Deployments →
⋯ → Rollback); the next release replaces it. The release workflow's own rollback (an older tag,
with its edge functions) is in docs/OPERATIONS.md, "Releases". The same commit can be built again with "Retry deployment", which is also how
a change to the project's settings (below) reaches the live site without a commit.

## The two Pages Functions

Pages builds `web/functions/` beside the output by itself (no setting), and generates the
`_routes.json` that decides which addresses invoke a Function from the files it finds there: with
the ones below (`/share`, `/r/*`, `/manifest.webmanifest`, `/cover`), everything else stays a free static request.
Nitro's `cloudflare-pages-static` preset writes no `_routes.json` of its own, so nothing overrides
that (checked with `npx wrangler pages functions build --output-routes-path`).

**`web/functions/share.js`** — a share to the installed app is a `POST /share` (the manifest's share
target, #91 and #131) that the service worker answers on the device. Only when it reaches Pages
instead (the very first share right after installing, before the service worker took over) does the
function answer: a 303 to `/share?title=&text=&url=`, plus `ebooks=missed` when files were shared,
so the app asks for the share again. It keeps nothing; a `GET /share` is not handled by it and gets
the static page. A POST that the browser says came from another site (`Sec-Fetch-Site` not
`same-origin`/`none`, or an `Origin` that is another origin) is sent Home unread, here and in the
service worker (security round F4: any page can submit that form). Whatever the worker keeps still
waits for the member's tap on `/share` (Add / Not now); nothing is imported by a POST.

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
  so the app shows its own "no such page" screen. The two functions never raise for an unknown
  token, they answer `200` with `null`, so that is the only "no such page" the database gives.
  Anything else it answers (a 5xx, a rejected key) or a network error means it could not be asked,
  which is **not** a 404: the plain shell goes out with 200 and the app asks again in the browser.
- Any address under `/r/` that is not shaped like a token (22 characters of `A-Za-z0-9_-`, then
  optionally `/book/<uuid>`), such as `/r/nonsense`, is a 404 with the shell too, and a plain 404
  for an `…/og.png`, without asking the database: the SPA fallback must not tell a crawler that a
  page which cannot exist is there.
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
  therefore sets the headers of the `/*` rule itself (the Content-Security-Policy-Report-Only
  included) where the shell's response does not already carry them (`SITE_HEADERS` in the file;
  keep it in step with `_headers`).
- Web Analytics: Pages adds its beacon to the Function's HTML as to any other page (checked on
  the pull request's preview, `curl -s <deployment>/r/<token> | grep cloudflareinsights`), so a
  visit to a reading page is counted like any page load, without cookies.

**`web/functions/manifest.webmanifest.js`** (German group B of #257) — the web app manifest, in German for a German
browser. A manifest has no per-language members, but the browser asks for it with its own `Accept-Language` at install
and at every update check: the Function answers the built file untouched, and, when the browser's first language the app
speaks is German, the same file with `lang: de`, a German `description` and German shortcut names (`app/utils/manifestText.ts`;
`name` and `short_name` are the brand and never change). It sets `Vary: Accept-Language` and `Cache-Control: no-cache` itself
(`_headers` does not reach it), and hands the asset back as it is when it cannot read it. Not verified on Cloudflare itself
(no production access here): after the first deploy, `curl -H 'Accept-Language: de' https://<site>/manifest.webmanifest` should
say `"lang":"de"`.

Everything else stays static, and only `/share`, `/r/*` and `/manifest.webmanifest` invoke a Function.

## The cover cache

**`web/functions/cover.js`** answers `/cover?u=<cover URL>&w=<width>`: our own cache in front of the two cover
hosts (Apple's `*.mzstatic.com` and `covers.openlibrary.org`). Open Library's covers take 0.7–3 s (a redirect
to archive.org and a storage host of its own); a cover at an address never changes, so the first request pays
and the rest are answered from Cloudflare's Cache API (`caches.default`) in a few milliseconds. The answer
carries `Cache-Control: public, max-age=31536000, immutable`, the image's own `Content-Type`, `Vary: Origin` and, for
a page that names itself by `Origin`, `Access-Control-Allow-Origin` for that origin (never `*`; the app's own pages
load it same-origin, a WebGL texture needs a CORS-clean image, so does a canvas read).

- **Who may ask.** A request that carries an `Origin` or a `Referer` (an `<img>` sends the page as `Referer`) must name
  this host or an origin in the Pages project's `COVER_ALLOWED_ORIGINS` variable (comma-separated: a second domain,
  a preview), otherwise it is a 403 with `no-store`, no CORS, and no host asked. A request with neither (curl) is
  not judged. **That keeps other sites from embedding our cache, no more. The guard against a flood burning the 100,000
  Function requests a day (shared with `/r` and `/share`) is a Cloudflare rate-limiting rule on `/cover`** (Security →
  WAF → Rate limiting rules, by IP, on the path), which no code in a Function can be; set it up in the dashboard.

- **An allowlist, not a proxy.** `parseCoverRequest` (`web/app/utils/coverSize.ts`, which the browser builds
  addresses with and the Function enforces) accepts `https://<n>.mzstatic.com/image/thumb/…/<w>x<h>bb.jpg` and
  `https://covers.openlibrary.org/b/<id|isbn|olid|oclc|lccn>/<key>-<S|M|L>.jpg[?default=false]`, and the widths
  120, 240, 360, 480 and 600 only (each width is an entry; no width asks for any size). Anything else is a 400
  with `no-store`, and no host is asked. The sized address (Apple's `<w>x<1.5w>bb`, Open Library's `-M` up to
  180 px, else `-L`) is computed here from `u` and `w`, and is the cache key: a stored `-L` and a `-M`, a
  600×900 and a 120×180 `u`, are one entry at one width.
- **When the host fails.** A cover in the cache is served as it is; one older than 30 days is served and
  fetched again behind the answer (stale-while-revalidate), the old copy kept (and left alone for an hour)
  when the host does not answer. A cover not in the cache and not fetchable is a 502 (404 for a cover the
  host says it has not) with `no-store`: the app never keeps it, and its chain tries the host's own address
  next (`coverChain`, `web/app/utils/cover.ts`), so the cache is never the reason a cover is missing. The
  host's answer must be an image under 2 MB, from the host (or Open Library's archive.org) after redirects.
- **No paid feature.** Only `caches.default` and `fetch`: no Cloudflare Images / Image Resizing (sizes are the
  hosts' own), no KV, R2 or Workers paid plan. What it uses up is the Workers **free plan's 100,000 Function
  requests a day** (docs above: only `/cover`, `/share`, `/r/*` and the manifest are Function requests; every
  other file is a free static one). Past it Pages answers the Function's addresses with an error, not a
  bill, and the chain falls back to the hosts' own covers. A device that has a cover in its service worker's
  `libellus-cover-cache` (CacheFirst, 300 entries, 180 days, emptied on sign-out with the other member
  caches) does not ask again.
- **In the app.** `runtimeConfig.public.coverProxy` (`NUXT_PUBLIC_COVER_PROXY`, `on`/`off`; unset: on in a
  Cloudflare Pages build, `CF_PAGES`, else off, so `nuxt dev`, the e2e build and a static host without Functions
  ask the hosts directly). `coverSrc(url, size, useCoverProxy())` is the app's covers through it (the Library's rows, `EntryRow`);
  `coverFor(url, { height, dpr, proxy })` is a cover at a size no token names (`coverSize.ts`).
- **Check it locally.** `pnpm dlx wrangler pages dev <a folder with an index.html> --port 3110` from `web/`
  (it serves `functions/` and a real `caches.default`), then `curl -si 'http://127.0.0.1:3110/cover?u=<encoded cover URL>&w=240'`:
  `X-Cover-Cache: miss`, then `hit`. Tests: `tests/cover-size.test.ts`, `tests/cover-function.test.ts`.

## Own covers

**`web/functions/c/[[path]].js`** answers `/c/<key>/<width>` on the app's own origin: the stored copies of covers of
Books in a member's Library (docs/plans/owned-covers.md, option B). The images are in the private R2 bucket
`libellus-covers` (no public access, no custom domain), read through an **R2 binding named `COVERS`**; the app builds the
address from a Book's `cover_key` and `cover_widths` (`web/app/utils/coverRef.ts`), and falls back to `/cover`, then the
source, so a copy that is missing is never a missing cover. The Function accepts exactly `/c/<32 hex>/<whole width, 16–2000>`,
`GET`/`HEAD` only, and answers a hit from `caches.default`, a miss from the bucket (the stored `Content-Type`,
`Cache-Control: public, max-age=31536000, immutable`, put into the cache behind the answer). Anything else, a missing
object, and **a bucket that is not bound yet** are a 404 with `no-store`. Who may ask is `/cover`'s rule
(`web/app/utils/coverSender.ts`, `COVER_ALLOWED_ORIGINS`).

- **The binding is an owner step of the release, not a file in the repo** (this project keeps its Pages settings in the
  dashboard, like `COVER_ALLOWED_ORIGINS`): Pages project → Settings → Bindings → R2 bucket → variable name `COVERS`, bucket
  `libellus-covers`, for production (and previews, if previews should show own covers). Nothing is deployed or created by
  the code.
- **Rate limiting and the WAF** rule on `/cover` get `/c/` added, in both zones (`fabkho.dev`, `betterreads.de`).
- **In the app.** `runtimeConfig.public.ownCovers` (`NUXT_PUBLIC_OWN_COVERS`, `on`/`off`; unset: **off in every build**).
  `coverImage(book, size, useCoverHosts())` is a cover at a token size, `coverAt(book, { height, dpr, origin, ...hosts })` one at
  any other size. Turning it on is a rebuild of the production deployment, never a release; unset it to go back.
- **Check it locally** (verified on workerd): `pnpm dlx wrangler r2 object put libellus-covers/c/<key>/<width> --file <image> --content-type image/webp --local --persist-to /tmp/r2`,
  then `pnpm dlx wrangler pages dev <a folder with an index.html> --port 3110 --r2 COVERS=libellus-covers --persist-to /tmp/r2` from `web/`,
  and `curl -si http://127.0.0.1:3110/c/<key>/<width>`: `X-Cover-Cache: miss`, then `hit`. Tests: `tests/cover-own-function.test.ts`,
  `tests/cover-ref.test.ts`.

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
`supabase functions deploy reading-page-og` (docs/OPERATIONS.md, docs/SETUP.md).

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
Function, also `/r/<22 characters nobody owns>` (404) and `/r/nonsense` (404, the shell).

## Response headers

`web/public/_headers` holds the headers the app decides (the comments say why), and the build
appends Nitro's: `/_nuxt/*` and `/_fonts/*` immutable for a year (their names carry a hash).
On top of Pages' defaults (`X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Access-Control-Allow-Origin: *`):

- `Strict-Transport-Security`, `X-Frame-Options: DENY`, a `Permissions-Policy` that allows only
  the camera (the barcode scanner), and only to BetterReads.
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
