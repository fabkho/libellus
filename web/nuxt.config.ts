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
        // viewport-fit=cover so the installed app can draw under the notch;
        // screens pad with env(safe-area-inset-*) through `screen-inset`.
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
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
        { rel: 'apple-touch-icon', href: '/icon-180.png' },
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

  // Installable from the home screen; the app shell is precached.
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'Libellus',
      short_name: 'Libellus',
      lang: 'en',
      display: 'standalone',
      orientation: 'portrait',
      // The manifest has no media queries: the splash and the default chrome
      // colour are the light theme's, which is the default theme.
      background_color: surface.light,
      theme_color: surface.light,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      navigateFallback: '/',
      // The module's defaults only pick up the build-meta JSON under `nuxt generate`;
      // the app shell, chunks and fonts have to be listed to be precached.
      globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
    },
    devOptions: { enabled: false },
  },
})
