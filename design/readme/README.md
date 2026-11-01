# The README hero

`docs/images/hero.jpg` is composed in HTML (`hero.html`) from real screens of the running app, never by hand.
`hero.html#a|b|c` are three layouts of the same idea, the Stack (Regal's pile of the year's books, `/profile/shelf`) on
the Night Reader room (`#3c3251` to `#211b2e`, cream `#f1e3c8`, lamp `#efb768`); `b` is the one shipped.

```sh
# the local stack up (`supabase start`) and a dev server WITH Regal, which the Stack needs
# (`cd web && LIBELLUS_REGAL=1 REGAL_LAYER=/path/to/regal pnpm dev`), then, in web/:
LIBELLUS_SHOTS_URL=http://localhost:3020 pnpm exec tsx scripts/hero-shots.ts shoot     # -> design/readme/shots/*.png (gitignored)
pnpm exec tsx scripts/hero-shots.ts compose --out /tmp/hero-options                     # -> a.png b.png c.png sheet.png
pnpm exec tsx scripts/hero-shots.ts compose --ship b                                    # also writes docs/images/hero.jpg
```

`shoot` signs up a throwaway member ("Mara", an `@libellus.test` address tagged `hero`), gives her a made-up year
of 32 reads over a year and a half, one in progress and four to read (Apple Books covers, their colours worked
out the way the app does it), photographs the screens in WebKit at 393 x 740 and 2x (the frame takes its shape from
the shot, never the other way round), taps a Book out of the Stack, then deletes the member and the Books it made. No real member, library
or address is in any image. Re-run both steps when the UI changes.
