import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import { themeBootScript, type ThemeColors } from './app/utils/theme'

// The browser chrome, the installed app's status bar and its splash take their
// colour from the same token source as the CSS: the room's surface, per theme.
const tokens = JSON.parse(readFileSync(new URL('../design/tokens.json', import.meta.url), 'utf8'))
const surface: ThemeColors = tokens.color.surface.$value

// Libellus web — the reference app (SPEC.md). Everything personal sits behind
// the sign-in, so there is nothing to render on the server: SPA, built to
// static files for Cloudflare Pages.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-02',
  ssr: false,
  // The devtools badge floats over the tab bar and swallows taps in the
  // Playwright run, which sets LIBELLUS_E2E (playwright.config.ts).
  devtools: { enabled: !process.env.LIBELLUS_E2E },

  modules: ['@pinia/nuxt', '@nuxtjs/i18n', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
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
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'icon', href: '/favicon.ico' },
      ],
    },
  },

  // Filled from NUXT_PUBLIC_SUPABASE_URL / NUXT_PUBLIC_SUPABASE_ANON_KEY (.env).
  runtimeConfig: {
    public: { supabaseUrl: '', supabaseAnonKey: '' },
  },

  // The theme store repaints the theme-color tags with these when the member
  // flips the switch (stores/theme.ts).
  appConfig: {
    themeColors: surface,
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
  // The icons are drawn by scripts/render-icons.mjs.
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
      // The manifest has no media queries: the splash and the default chrome
      // colour are the light theme's, which is the default theme.
      background_color: surface.light,
      theme_color: surface.light,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      navigateFallback: '/',
      // The module's defaults only pick up the build-meta JSON under `nuxt generate`;
      // the app shell, chunks and fonts have to be listed to be precached. Only
      // woff2 (the latin subsets main.css imports), never the woff fallbacks;
      // the icons the manifest names, not the larger ones nothing loads offline.
      globPatterns: ['**/*.{js,css,html,woff2}', 'icon-192.png', 'apple-touch-icon.png', 'favicon.ico'],
      globIgnores: ['**/_payload.json', '**/200.html', '**/404.html'],
      runtimeCaching: [
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
