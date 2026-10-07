import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import { themeBootScript, type ThemeColors } from './app/utils/theme'
import { isRegalModule, regalAssets, regalContainment, regalLayer, REGAL_ENABLED, REGAL_LIBRARY_SRC } from './regal.config'

// The browser chrome, the installed app's status bar and its splash take their
// colour from the same token source as the CSS: the room's surface, per theme.
const tokens = JSON.parse(readFileSync(new URL('../design/tokens.json', import.meta.url), 'utf8'))
const surface: ThemeColors = tokens.color.surface.$value

// Appended to every icon URL (?v=): bump it when the icons are redrawn so Chrome
// and the home-screen launchers refetch them instead of keeping the old ones.
const iconVersion = 2

// Libellus web — the reference app (SPEC.md). Everything personal sits behind
// the sign-in, so there is nothing to render on the server: SPA, built to
// static files for Cloudflare Pages.
export default defineNuxtConfig({
  // Regal, the owner's 3D shelf (#23): a Nuxt layer, only with LIBELLUS_REGAL=1 (regal.config.ts says
  // where it comes from and how it is kept to the shelf's pages).
  extends: regalLayer(),
  compatibilityDate: '2026-10-02',
  ssr: false,
  nitro: {
    // No top-level 404.html: Cloudflare Pages then serves its SPA fallback (index.html, status 200)
    // for an address with no file behind it (`/book/<id>`, `/profile/<year>`), not the app shell
    // with a 404 (docs/HOSTING.md, "Deep links"). Nuxt adds /200.html and /404.html to every
    // static build as fallbacks; the app uses neither, the service worker has its own. A gone file
    // under /_nuxt/ stays a real 404 through public/_nuxt/404.html (the closest 404 page wins).
    prerender: { ignore: ['/404.html'] },
  },
  // The devtools badge floats over the tab bar and swallows taps in the
  // Playwright run, which sets LIBELLUS_E2E (playwright.config.ts).
  devtools: { enabled: !process.env.LIBELLUS_E2E },

  modules: ['@pinia/nuxt', '@nuxtjs/i18n', '@vite-pwa/nuxt', regalContainment],
  // Accessibility and hints in Nuxt DevTools (docs/ACCESSIBILITY.md): `nuxt dev` only, never in a
  // build (both modules also do nothing outside dev, and `$development` keeps them out of the
  // generate run altogether), and not in the Playwright run, where the DevTools are off and an
  // axe scan after every tap would only slow WebKit down; e2e/a11y.spec.ts runs axe there instead.
  $development: {
    modules: process.env.LIBELLUS_E2E ? [] : ['@nuxt/a11y', '@nuxt/hints'],
    a11y: { logIssues: true },
    // A SPA renders nothing on a server: no hydration to compare, no SSR render to find unused
    // components in. Web vitals, third-party scripts and the HTML check stay on.
    hints: { features: { hydration: false, lazyLoad: false } },
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    // `nuxt dev` bundles a package the first time a page imports it. A package first met while a
    // member (or a Playwright flow) is already on the page is bundled then: the dev server
    // re-optimizes, and a page open at that moment can be reloaded under its user, so a tap on
    // Profile → Import (papaparse) or a sign-in in another tab ends where it started (issue #146).
    // These are the packages the app reaches only from a later screen or a lazy import; bundled at
    // start-up, none is met late. Dev only: a build never asks.
    optimizeDeps: { include: ['@supabase/supabase-js', 'thumbhash', 'fflate', 'papaparse', 'zxing-wasm/reader'] },
    build: {
      rolldownOptions: {
        output: {
          // The barcode decoder (WebAssembly, for browsers without a native BarcodeDetector,
          // #92) is one chunk with a name of its own, so the service worker can leave it out
          // of the precache (pwa.workbox.globIgnores) and it is only fetched when the scanner opens.
          // Regal (three.js, TresJS, its components; the owner's shelf, #23) likewise: one chunk
          // named `regal`, only imported by the shelf's async component, left out of the precache.
          codeSplitting: {
            groups: [
              { name: 'zxing', test: /zxing-wasm/ },
              // Only what the test names: Regal's modules use the app's Vue and Nuxt, which stay where they are.
              { name: 'regal', test: isRegalModule, includeDependenciesRecursively: false },
            ],
          },
          chunkFileNames: (chunk: { name: string }) =>
            chunk.name === 'zxing' || chunk.name === 'regal' ? `_nuxt/${chunk.name}.[hash].js` : '_nuxt/[hash].js',
        },
      },
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      // The static shell's title, for the moment before the app sets its own from the message file
      // (app.vue): a page without one is announced by its address.
      title: 'Libellus',
      meta: [
        // viewport-fit=cover so the installed app can draw under the notch (and
        // Chrome on Android edge to edge, behind its gesture bar); screens pad
        // with env(safe-area-inset-*) through the utilities in main.css.
        // interactive-widget=resizes-content: Chrome on Android shrinks the page
        // to what the keyboard leaves, so whatever sits at the bottom (the search
        // palette, a sheet) stands on the keyboard by itself, the way an Android
        // app's window resizes. Safari ignores it and lays the keyboard over the
        // page, which useKeyboardInset follows instead.
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content' },
        // One per appearance, so the device decides while no theme is chosen;
        // a chosen theme overwrites both (utils/theme.ts, applyPreference). No
        // `key`: the head manager tells the two apart by `media` and adopts the
        // static tags on boot; a key would make it add a second pair.
        { name: 'theme-color', media: '(prefers-color-scheme: light)', content: surface.light },
        { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: surface.dark },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        // `default`: the installed app's status bar takes the theme-color above
        // and picks dark or light glyphs to match, so it follows the theme.
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      ],
      // Before anything else in <head>: puts a stored theme on <html> before the
      // first paint, so the app never flashes the other theme while it boots.
      script: [{ key: 'theme-boot', innerHTML: themeBootScript(surface), tagPosition: 'head', tagPriority: 'critical' }],
      link: [
        // In the static HTML rather than through <NuxtPwaManifest />: with ssr off
        // that component only adds the link once the app has booted.
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: `/apple-touch-icon.png?v=${iconVersion}` },
        { rel: 'icon', href: `/favicon.svg?v=${iconVersion}`, type: 'image/svg+xml' },
        { rel: 'icon', href: `/favicon.ico?v=${iconVersion}`, sizes: '32x32 16x16' },
      ],
    },
  },

  // Every value an instance sets for itself, from NUXT_PUBLIC_* env vars at build time (the table in
  // docs/SELF_HOSTING.md). All of it ends up in the static files: public by nature, never a secret.
  runtimeConfig: {
    public: {
      // NUXT_PUBLIC_SUPABASE_URL / NUXT_PUBLIC_SUPABASE_ANON_KEY (.env).
      supabaseUrl: '',
      supabaseAnonKey: '',
      // The owner's auth user id (NUXT_PUBLIC_SHELF_OWNER_ID): only she sees Your shelf (#23), and only
      // in a build with Regal. Empty: nobody does.
      shelfOwnerId: '',
      // The client error log (composables/useErrorLog.ts, NUXT_PUBLIC_ERROR_LOG): a build sends
      // its errors unless 'off'; the dev server prints them and sends only with 'send'.
      errorLog: '',
      // Regal's setting (its README): the published library file (NUXT_PUBLIC_REGAL_LIBRARY_SRC).
      regal: { librarySrc: REGAL_LIBRARY_SRC },
      // Book links every member of this instance sees on a Book's page before her own
      // (NUXT_PUBLIC_LINK_TEMPLATES, JSON: [{ "label": …, "url": … }]; utils/linkTemplates.ts).
      // Public like everything here; a member's own links are hers alone (data/linkTemplates.ts).
      linkTemplates: '',
    },
  },

  // The theme store repaints the theme-color tags with these when the member
  // flips the switch (stores/theme.ts).
  appConfig: {
    themeColors: surface,
    // Whether this build has Regal (LIBELLUS_REGAL=1): fixed at build time, unlike runtimeConfig,
    // so no env var can point the app at a shelf the build doesn't have (stores/shelf.ts).
    regal: REGAL_ENABLED,
  },

  // One locale and every string in i18n/locales/en.json, so German is a
  // mechanical follow-up and a native port maps the keys onto its string
  // catalogue. No URL prefix: there is only one language to route to.
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    locales: [{ code: 'en', language: 'en', file: 'en.json' }],
  },

  // Installable from the home screen, full-screen once opened from there; the
  // app shell is precached and the covers are cached as they are seen (#15).
  // The icons are rendered from design/icons/app/*.svg by scripts/render-icons.mjs.
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      id: '/',
      name: 'Libellus',
      short_name: 'Libellus',
      description: 'Your books: what you want to read, what you are reading, what you have read.',
      lang: 'en',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      // The manifest has no media queries (Chrome on Android doesn't support the
      // draft's user_preferences), so the splash Android draws while the app
      // starts takes one colour for everyone: the night room. The ribbons icon
      // sits on dark red, a light splash flashed white on dark phones, and a dark
      // splash before the light theme reads as the brand, not a glitch.
      background_color: surface.dark,
      theme_color: surface.dark,
      icons: [
        { src: `/icon-192.png?v=${iconVersion}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `/icon-512.png?v=${iconVersion}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `/icon-maskable-512.png?v=${iconVersion}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        // Alpha only: the launcher tints it when the member turns themed icons on.
        { src: `/icon-monochrome-512.png?v=${iconVersion}`, sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
      ],
      // Sharing to Libellus from another app. A link or text (issue #91: Goodreads, Amazon, a
      // browser, a bookstore app) opens the app at /share?title=&text=&url= (pages/share.vue),
      // which finds the Book and goes to its page. EPUB files, one or many (issue #131: from the
      // download notification or the file manager), are taken in and linked to Books. A manifest
      // has one share_target and files make it a multipart POST, so the service worker answers
      // every share (public/sw-share.js): files are kept on the device for the app to take, text
      // is redirected to the same GET address as before.
      share_target: {
        action: '/share',
        method: 'POST',
        enctype: 'multipart/form-data',
        params: {
          title: 'title',
          text: 'text',
          url: 'url',
          files: [{ name: 'ebooks', accept: ['.epub', 'application/epub+zip'] }],
        },
      },
      // Long-press the icon (issue #91). The addresses are read by the shell (composables/useLaunch.ts).
      shortcuts: [
        {
          name: 'Search',
          short_name: 'Search',
          description: 'Find a book to add',
          url: '/?search=1',
          icons: [{ src: `/shortcut-search-96.png?v=${iconVersion}`, sizes: '96x96', type: 'image/png' }],
        },
        {
          name: 'Update progress',
          short_name: 'Progress',
          description: 'Update the book you are reading',
          url: '/?progress=1',
          icons: [{ src: `/shortcut-progress-96.png?v=${iconVersion}`, sizes: '96x96', type: 'image/png' }],
        },
        {
          name: 'Library',
          short_name: 'Library',
          description: 'Your books',
          url: '/library',
          icons: [{ src: `/shortcut-library-96.png?v=${iconVersion}`, sizes: '96x96', type: 'image/png' }],
        },
      ],
    },
    workbox: {
      navigateFallback: '/',
      // A member's public reading page and its Book cards (#171) always come from the network: the
      // Pages Function in front of them (functions/r/[[path]].js) puts the link preview's tags into
      // the shell and answers a dead link with a 404, which the precached shell would hide. Nothing
      // caches those answers either (no runtime route takes documents), so the shell this device
      // keeps for the app is never one carrying somebody's page.
      navigateFallbackDenylist: [/^\/r(\/|$)/],
      // Background Sync wakes the open app to send the outbox (#93, public/sw-sync.js); the share
      // target's POST is answered by public/sw-share.js (#91, #131).
      importScripts: ['/sw-sync.js', '/sw-share.js'],
      // The module's defaults only pick up the build-meta JSON under `nuxt generate`;
      // the app shell, chunks and fonts have to be listed to be precached. Only
      // woff2 (the latin subsets main.css imports), never the woff fallbacks;
      // the icons the manifest names, not the larger ones nothing loads offline.
      globPatterns: ['**/*.{js,css,html,woff2}', 'icon-192.png', 'apple-touch-icon.png', 'favicon.ico', 'favicon.svg'],
      // The icon URLs carry ?v= to make browsers refetch a redrawn icon; the precache holds them without it.
      ignoreURLParametersMatching: [/^v$/],
      // The barcode decoder (a script chunk and a 0.9 MB module) is not part of the app shell: it is
      // fetched when the scanner first opens, and kept by the cache below.
      // Nor is Regal (the owner's shelf, #23): its chunk and styles, its fonts and its model are
      // fetched when the shelf first opens, and kept by the caches below.
      globIgnores: ['**/_payload.json', '**/200.html', '**/404.html', '**/zxing*.js', '**/zxing_reader*.wasm', ...regalAssets().globIgnores],
      runtimeCaching: [
        ...regalAssets().runtimeCaching,
        {
          // The barcode decoder, as the scanner asks for it. Cache first: the file's name carries its hash.
          urlPattern: ({ url }) => /\/_nuxt\/zxing[^/]*\.(js|wasm)$/.test(url.pathname),
          handler: 'CacheFirst',
          options: { cacheName: 'libellus-barcode-decoder', expiration: { maxEntries: 4 } },
        },
        {
          // Covers as an <img> asks for them (no-cors: an opaque answer, which
          // is fine to keep and show). A cover read with CORS (its thumbhash
          // while a Book is added) goes to the network, never to an opaque copy
          // it could not read. Cache first: a cover at an address never changes.
          urlPattern: ({ request, url }) =>
            request.destination === 'image' &&
            request.mode === 'no-cors' &&
            (/(^|\.)mzstatic\.com$/.test(url.hostname) || url.hostname === 'covers.openlibrary.org'),
          handler: 'CacheFirst',
          options: {
            cacheName: 'libellus-covers',
            // Opaque answers have status 0; keep them, and the real 200s.
            cacheableResponse: { statuses: [0, 200] },
            // Bounded: the oldest covers go first, and everything goes before
            // the browser runs out of room for the rest of the app.
            expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 180, purgeOnQuotaError: true },
          },
        },
      ],
    },
    devOptions: { enabled: false },
  },
})
