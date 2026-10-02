import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'

// The browser chrome and the installed app's splash take their colour from the
// same token source as the CSS, so the design round only edits tokens.json.
const tokens = JSON.parse(readFileSync(new URL('../design/tokens.json', import.meta.url), 'utf8'))
const surface: string = tokens.color.surface.$value

// Libellus web — the reference app (SPEC.md). Everything personal sits behind
// the sign-in, so there is nothing to render on the server: SPA, built to
// static files for Cloudflare Pages.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-02',
  ssr: false,
  devtools: { enabled: true },

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
        { name: 'theme-color', content: surface },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      ],
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
      background_color: surface,
      theme_color: surface,
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
