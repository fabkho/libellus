# reading-page-og

The link-preview image of a reading page (issue #171): what WhatsApp, Signal, iMessage, Mastodon
or Slack show when the link she handed out is pasted somewhere. One image for the page, one per
Book card.

```
GET /functions/v1/reading-page-og?token=<token>              her page
GET /functions/v1/reading-page-og?token=<token>&book=<uuid>  one Book's card

200 image/png, 1200×630, Cache-Control: public, max-age=86400
404 the token is unknown (the page is off, the link was renewed) or the Book is not published
502 the database could not be asked
```

Nobody calls it directly: the Pages Function in front of it (`web/functions/r/[[path]].js`,
docs/HOSTING.md) puts its address into the page's `og:image` and caches the answer at Cloudflare's
edge.

## Why an edge function and not the Pages Function

Pages Functions run on the Workers free plan, which gives a request about 10 ms of CPU. A satori
layout plus a resvg raster of a 1200×630 PNG needs far more than that (~100 ms warm, measured in
the tests here). A Supabase edge function has a 2 s CPU budget, the stack already runs Deno edge
functions with Deno tests in CI, and the image is cached for a day in front of it, so the render
happens once per link and version.

## How it answers (`handler.ts`)

1. The token (22 base64url characters) and, for a card, the Book id are checked against their
   shape. Anything else is a 404 — a crawler never learns whether a link ever existed.
2. `public_reading_page(token)` or `public_book_card(token, book)` over PostgREST with the **anon
   key**: the same two functions the page itself reads, so a renewed or switched-off link stops
   producing images at once, and nothing she did not publish can reach an image. `null` is a 404.
3. The covers are fetched (https only, 2.5 s each, `image/*` and at most 5 MB) and passed to satori
   as data URLs. A cover host that refuses, 404s or hangs costs only that one cover: its block in
   the Book's own colour stands in, as in the app.
4. satori lays the image out and resvg turns the SVG into the PNG.

The page image: "<Name>'s reading" (or "A reading page"), the line of what the page shows, and up
to five covers — what she is reading now first, then recently finished, favourites and the shelf.
The card image: the cover large on the left, the title, the first author, her Rating as five stars
filled to the quarter plus the figure (or "Reading now" / "Wants to read"), and her review when she
shared it. Direction D "Night Reader" throughout (docs/DESIGN.md): the dark room, the lamp, serif
titles, mono figures.

## Files

- `page.ts` — pure: the shapes the two database functions return, the title, the summary line, the
  covers an image shows, a Rating as a figure, text cut to length. No I/O.
- `render.ts` — the two layouts, the fonts, the covers and the SVG stars; satori and resvg.
- `handler.ts` — the request/response logic. `fetch` injected (database and covers both).
- `index.ts` — the wiring: the stack's URL and anon key from the environment, `Deno.serve`.
- `fonts/` — the bundled type (below). `fixtures/` — a page and a card as the database returns them.
- `handler_test.ts`, `page_test.ts` — unit tests; no request leaves the process.

## Fonts

satori reads TTF/OTF, not woff2, so the three families of the design system are bundled here as
latin subsets (~145 KiB together), made from the Google Fonts originals (both OFL-1.1: Geist,
Newsreader):

```sh
curl -s 'https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,500;1,400&family=Geist+Mono:wght@500&family=Geist:wght@400'
# follow the .ttf addresses in the answer, then per file:
pyftsubset <font>.ttf --output-file=fonts/<font>.ttf --no-hinting --layout-features="kern,liga,tnum,calt" \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0301,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+00AB,U+00BB,U+FEFF,U+FFFD"
```

`Geist` for plain text, `Geist Mono` for figures and eyebrows, `Newsreader` for book titles and,
italic, for the wordmark and reviews. Stars are drawn as an SVG, not typed: the subsets carry
letters, not star glyphs. resvg's WebAssembly comes out of the npm package in the bundle, never
from a CDN at runtime.

## Local

```sh
cd supabase/functions/reading-page-og && deno task test   # unit tests, offline
supabase functions serve reading-page-og                  # from the repo root, against the local stack
```

`deno task test` is `deno test --allow-read --allow-env`: the fonts and the resvg WebAssembly are
read off the disk (the npm cache), and satori's dependencies read `NODE_ENV`.

To look at an image while changing the layout, render the fixtures into files:

```sh
cd supabase/functions/reading-page-og
deno eval --ext=ts --allow-read --allow-env --allow-write=/tmp '
  const { renderPage } = await import("./render.ts")
  const { readFixture, stubFetch } = await import("./test_support.ts")
  await Deno.writeFile("/tmp/og.png", await renderPage(readFixture("page.json"), { fetch: stubFetch({ cover: "png" }).fetch }))'
```

## Deploy (hosted)

```sh
supabase functions deploy reading-page-og
```

It reads `verify_jwt = false` and `static_files` from `config.toml` (the fonts have to travel with
the bundle; static files need the Docker build, not `--use-api`). No secrets: the runtime provides
`SUPABASE_URL` and `SUPABASE_ANON_KEY`. Until it is deployed the Pages Function sends a link
preview to the Book's cover or the app icon instead, so nothing breaks while it is missing.
