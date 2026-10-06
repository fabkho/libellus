# Libellus

A calm, mobile-first book tracker you install from the home screen: search a book → **Want to
read** → **Currently reading** → **Finished**, with the date, a quarter-star rating and a few words.
No social feed, no ads, no trackers. Built web first on Nuxt and Supabase, with the docs that make a
later Swift/Kotlin port mechanical.

![Libellus on a phone: Home in the light theme, a Book and the Profile in the dark theme](docs/images/hero.jpg)

Libellus runs as one small, invite-only instance for its owner and a few friends
(libellus.fabkho.dev), and anyone can run their own: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## What it does

- **Find a book fast.** One search field asks Apple Books, Open Library and the instance's own
  Catalogue at once and shows one merged list, one row per book; a barcode scan or an ISBN goes
  straight to the edition. Where a result came from is never shown. Books with no match can be
  typed in by hand and stay private.
- **Every read counts.** Start and finish dates, a rating in quarter stars, a review, re-reads and
  books you put down (DNF) are all reading sessions of their own, editable afterwards.
- **Progress** in pages or percent, with a day-by-day chart and a reading log, and your own page
  count when the edition's is wrong. Change edition keeps the history.
- **Collections**, your own shelves, in your order.
- **Your reading in figures**: the Profile with books, pages, average rating and pace by year, and
  a year in review per year.
- **Bring your history**: drop a Goodreads or Hardcover export (CSV) and it is told apart by its
  header; shelves, lists, every read with its days, ratings and reviews come along. Fable exports
  through the Goodreads format.
- **Book links**: your own short list of links (a library catalogue, a shop) that every Book's page
  offers, filled with its ISBN, title or author. Kept with your account, visible to nobody else.
- **Goodreads' community rating** under a Book's facts, looked up server-side and cached (optional).
- **Works offline**: the Library, Collections and figures are kept on the device; changes made
  offline wait in an outbox and sync once you are back.
- **An app, not a website**: installable (PWA), full screen, share a link from another app to open
  the book, long-press shortcuts, light and dark themes ("Night Reader").
- **Invite-only accounts** with a six-digit code by email; no passwords. Delete your account from
  the app.

| Home (light) | Library (light) | Home (dark) | A Book (dark) | Profile (dark) |
| --- | --- | --- | --- | --- |
| ![Home in the light theme](docs/images/home-light.jpg) | ![The Library](docs/images/library-light.jpg) | ![Home in the dark theme](docs/images/home-dark.jpg) | ![A Book's page with its Book links](docs/images/book-dark.jpg) | ![The Profile](docs/images/profile-dark.jpg) |

## Privacy

- **No trackers, no ads, no third-party code in the app.** The session is the only thing it
  stores for sign-in; everything else on the device is your own data, kept for offline use and
  removed when you sign out.
- **Your data is yours**: row-level security in the database means a member only ever reads her own
  Library, reviews, Collections and Book links. Delete your account and all of it goes.
- **Search stays plain**: the browser asks Apple Books and Open Library directly for the words you
  type, nothing else; the Goodreads rating is looked up by the server, so Goodreads never sees you.
- An instance may count page loads with a cookieless, identifier-free analytics service (the
  owner's uses Cloudflare Web Analytics, docs/HOSTING.md). A fresh instance has none.
- **Errors stay in your own database**: the app reports its own crashes (message, stack, screen,
  app version; never a Book, note or search) to a table in the instance's Supabase, kept 30 days
  (docs/OPERATIONS.md). No third-party error service.

## Tech stack

| | |
| --- | --- |
| App | [Nuxt 4](https://nuxt.com) as a single-page app (`ssr: false`), Vue 3, TypeScript, Pinia, Tailwind CSS v4 on generated design tokens, `@vite-pwa/nuxt` |
| Backend | [Supabase](https://supabase.com): Postgres with the rules in the database (constraints, triggers, RPC, RLS), Auth (email codes), two Deno edge functions |
| Hosting | Static files on Cloudflare Pages (any static host works) |
| Tests | pgTAP for the database, Vitest for the data layer against a real local stack, Playwright flows in WebKit at iPhone size |

## Quick start (local)

Needs Docker, Node 24, pnpm and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```sh
git clone https://github.com/fabkho/libellus && cd libellus
supabase start                 # the local stack on ports 55320–55329: Postgres, Auth, Studio, a mail catcher
cd web
cp .env.example .env           # paste the anon key `supabase start` printed
pnpm install
pnpm dev                       # http://localhost:3020, best in a phone-sized viewport
```

Sign in as `dev@libellus.local` (the six-digit code lands in the local mailbox at
http://127.0.0.1:55324), or sign up with any address and the invite code `LIBELLUS-DEV`. Tests,
design tokens, the layout of the repository and everything else for working on the code:
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation

| | |
| --- | --- |
| [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) | Run your own instance: Supabase, Cloudflare Pages, invites, every setting in one table |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Run, test and change it locally |
| [docs/HOSTING.md](docs/HOSTING.md) | How the owner's instance is built and served on Cloudflare Pages |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | The client error log and how to read it |
| [docs/TESTING.md](docs/TESTING.md) | The test suites, CI, and checks on a real Android device |
| [SPEC.md](SPEC.md), [CONTEXT.md](CONTEXT.md) | The spec sheet and the domain words |
| [docs/DESIGN.md](docs/DESIGN.md), [docs/MOTION.md](docs/MOTION.md) | The design system ("Night Reader") and its motion |
| [docs/parity.md](docs/parity.md) | Per-screen behaviour, the reference for a native port |
| [docs/OWNER.md](docs/OWNER.md) | Tooling only the owner's instance uses (the Fable import, the 3D shelf) |

## Contributing, security, license

Libellus is a personal project; issues are welcome, and pull requests for bugs and small things too
([CONTRIBUTING.md](CONTRIBUTING.md)). Please report security problems privately
([SECURITY.md](SECURITY.md)).

**License: [MIT](LICENSE).** The 3D shelf (Regal) is a separate, private layer and not part of this
license; Libellus builds and runs without it.
