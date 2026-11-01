# The README hero

`docs/images/hero.jpg` is composed in HTML (`hero.html`) from real screens of the running app, never by hand.
`hero.html#a|b|c` are three layouts of the same idea (BetterReads on the Night Reader room: `#3c3251` to `#211b2e`,
cream `#f1e3c8`, lamp `#efb768`); `b` is the one shipped.

```sh
# from the repo root: the local stack up (`supabase start`), a dev server (`cd web && pnpm dev`), then, in web/:
LIBELLUS_SHOTS_URL=http://localhost:3020 pnpm exec tsx scripts/hero-shots.ts shoot     # -> design/readme/shots/*.png (gitignored)
pnpm exec tsx scripts/hero-shots.ts compose --out /tmp/hero-options                     # -> a.png b.png c.png sheet.png
pnpm exec tsx scripts/hero-shots.ts compose --ship b                                    # also writes docs/images/hero.jpg
```

`shoot` signs up a throwaway member ("Mara", an `@libellus.test` address tagged `hero`), gives her a made-up year
of fifteen reads, one in progress and four to read (covers the sign-in wall already uses), photographs the
screens in WebKit at iPhone size and 2x, then deletes the member and the Books it made. No real member, library
or address is in any image. Re-run both steps when the UI changes.
