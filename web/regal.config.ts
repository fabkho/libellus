import { join } from 'node:path'
import { defineNuxtModule } from 'nuxt/kit'

/**
 * Regal, the owner's 3D shelf (#23), as a Nuxt layer: where it comes from, and
 * how it is kept to the places that show it (Profile → Your shelf, its full
 * Stack, and the row in a year in review). Everything else in the app builds, loads and
 * precaches exactly as without it.
 *
 * Where from, like the portfolio: a local checkout when REGAL_LAYER is set
 * (`REGAL_LAYER=/Users/fabkho/code/regal-v2`), otherwise the default branch of
 * the private repo fabkho/regal, downloaded with the token in GIGET_AUTH (a
 * GitHub token that can read it; the Cloudflare Pages build and CI have it).
 * Without either, `nuxt dev` and `nuxt generate` stop with a message saying so;
 * only `nuxt prepare` (the postinstall) goes on without it, so an install works
 * anywhere.
 *
 * What the layer brings, and where it goes:
 * - Its components (`RegalBooksStage`, `RegalBooksRow`) and composables,
 *   auto-imported. Only `components/shelf/Stage.vue` and `Row.vue` use them,
 *   and only through an async import (`LazyShelfStage`, `LazyShelfRow`), so
 *   they, three.js and TresJS end up in one chunk named `regal`
 *   (nuxt.config.ts, codeSplitting) that the entry never imports: the build
 *   fails if it ever does (below).
 *   The owner's idle warm-up (composables/useShelfPreload.ts) reaches Regal's
 *   `preloadRegal` only by a dynamic `import('#layers/regal/…')`, behind
 *   `shelf.isOwner`, so it too lands in that chunk and nobody else fetches it.
 * - Its fonts (IBM Plex Mono, Patua One, Antonio): @nuxt/fonts registers them
 *   globally, in the entry stylesheet. Moved out of it: the shelf's stage and
 *   row import that stylesheet themselves, so the @font-face rules arrive with the
 *   regal chunk, and their files (`/_fonts/`) are fetched when the Spines are
 *   drawn.
 * - Its `public/models/` (the Bookcase, which the Stack-only stage never
 *   loads): left out of the output.
 * - No pages, server routes or global CSS: Regal's own layer module keeps them
 *   to Regal's site.
 */

/** The published library file the portfolio shows (`books.fabkho.dev`, its CORS allows Libellus). */
export const REGAL_LIBRARY_SRC = 'https://books.fabkho.dev/v2/library.json'

const MISSING = [
  'Libellus extends Regal (the owner\'s shelf, #23), and Regal could not be found.',
  'Set REGAL_LAYER to a checkout of fabkho/regal (REGAL_LAYER=/path/to/regal),',
  'or GIGET_AUTH to a GitHub token that can read the private repo fabkho/regal',
  '(the Cloudflare Pages build and CI read it from their secrets).',
].join('\n')

/** `nuxt prepare` (the postinstall): types only, so it may go on without the layer. */
const isPrepare = () => process.argv.slice(2).includes('prepare')

/** The `extends` of nuxt.config.ts. */
export function regalLayer(): (string | [string, Record<string, unknown>])[] {
  const local = process.env.REGAL_LAYER?.trim()
  // A trailing slash: a folder, not a package name.
  if (local) return [local.replace(/\/?$/, '/')]
  const auth = process.env.GIGET_AUTH?.trim()
  if (auth) return [['github:fabkho/regal', { install: true, auth }]]
  if (isPrepare()) {
    console.warn(`[regal] ${MISSING}\nPreparing without it: the shelf's components have no types.`)
    return []
  }
  throw new Error(`[regal] ${MISSING}`)
}

/** Where the layer was found; set by the module below before anything is bundled. */
let regalDir: string | null = null

// three.js and what renders it; Regal's components and utilities (its folder);
// the two Libellus components that use them, and the fonts' stylesheet they import. Nothing else in
// the app imports these.
const REGAL_PACKAGES = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:three|three-stdlib|@tresjs|gsap|@vueuse|@monogrid|troika-[^\\/]+|camera-controls|postprocessing|stats-gl|meshoptimizer|bidi-js|webgl-sdf-generator)[\\/]/
const SHELF_STAGE = /[\\/]app[\\/]components[\\/]shelf[\\/](?:Stage|Row)\.vue|nuxt-fonts-global\.css/

/** Whether a module belongs in the `regal` chunk (nuxt.config.ts, codeSplitting). */
export function isRegalModule(id: string): boolean {
  if (REGAL_PACKAGES.test(id) || SHELF_STAGE.test(id)) return true
  return regalDir !== null && id.startsWith(regalDir)
}

/** The @nuxt/fonts stylesheet with Regal's global @font-face rules (imported by ShelfStage and ShelfRow). */
const FONTS_STYLESHEET = '#build/nuxt-fonts-global.css'

/**
 * The service worker's part (nuxt.config.ts, pwa.workbox): what it leaves out, and how it keeps it
 * once fetched. Workbox copies each `urlPattern` into sw.js as source text, so they use literals
 * only, no names from this file (REGAL_LIBRARY_SRC's address is written out again).
 */
export const REGAL_ASSETS = {
  globIgnores: ['**/regal.*.js', '**/regal.*.css', '_fonts/**', 'models/**'],
  runtimeCaching: [
    {
      // The chunk, its stylesheet and the fonts, as the shelf asks for them. Cache first: the names carry their hash.
      urlPattern: ({ url }: { url: URL }) => /^\/(_nuxt\/regal\.[^/]+\.(js|css)|_fonts\/[^/]+)$/.test(url.pathname),
      handler: 'CacheFirst' as const,
      options: { cacheName: 'libellus-shelf-code', expiration: { maxEntries: 60 } },
    },
    {
      // The library file: the newest when there is a connection, the last one seen without.
      urlPattern: ({ url }: { url: URL }) => url.href === 'https://books.fabkho.dev/v2/library.json',
      handler: 'NetworkFirst' as const,
      options: { cacheName: 'libellus-shelf-library', networkTimeoutSeconds: 6, expiration: { maxEntries: 2 } },
    },
    {
      // Its images (fronts, Spines, backs, the pile's small copies), read with CORS as WebGL
      // textures. Cache first: a published image keeps its address. Bounded, and the first to go.
      urlPattern: ({ url, request }: { url: URL; request: Request }) =>
        url.origin === 'https://books.fabkho.dev' && request.destination !== 'document' && /\.(webp|jpe?g|png)$/.test(url.pathname),
      handler: 'CacheFirst' as const,
      options: {
        cacheName: 'libellus-shelf-images',
        expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90, purgeOnQuotaError: true },
      },
    },
  ],
}

/** The containment described at the top. */
export const regalContainment = defineNuxtModule({
  meta: { name: 'libellus-regal-containment' },
  setup(_options, nuxt) {
    // Regal names itself (`$meta: { name: 'regal' }`); c12 keeps that on the layer.
    const layer = nuxt.options._layers.find((l) => {
      const named = l as { meta?: { name?: string }; config: { $meta?: { name?: string } } }
      return (named.meta?.name ?? named.config.$meta?.name) === 'regal'
    })
      regalDir = layer ? layer.cwd.replace(/\/?$/, '/') : null

    // The global @font-face rules leave the entry stylesheet (ShelfStage imports them).
    nuxt.hook('modules:done', () => {
      nuxt.options.css = nuxt.options.css.filter((entry) => entry !== FONTS_STYLESHEET)
    })

    // `nuxt dev`: Vite pre-bundles what Regal imports (three.js, TresJS …) when it starts, not
    // when the shelf first opens. Found then, they would make it reload the page under the
    // member (and the flows) the first time: Regal's files are not reached from the app's entry.
    if (nuxt.options.dev && regalDir) {
      const dir = regalDir
      nuxt.hook('vite:extendConfig', (config) => {
        const optimizeDeps = (config.optimizeDeps ??= {})
        const entries = optimizeDeps.entries === undefined ? [] : [optimizeDeps.entries].flat()
        optimizeDeps.entries = [...entries, `${dir}app/components/**/*.vue`]
      })
    }

    // Regal's public folder (the Bookcase model) stays out of the output.
    nuxt.hook('nitro:config', (config) => {
      if (!regalDir) return
      const regalPublic = join(regalDir, 'public')
      config.publicAssets = (config.publicAssets ?? []).filter((asset) => !asset.dir?.startsWith(regalPublic))
    })

    // The guard: the app's entry must never load Regal up front. Walks what the entry imports
    // statically; a `regal` chunk among them fails the build with the path that pulled it in.
    nuxt.hook('build:manifest', (manifest) => {
      const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry)
      for (const [key] of entries) {
        const seen = new Set<string>()
        const walk = (id: string, path: string[]) => {
          if (seen.has(id)) return
          seen.add(id)
          const chunk = manifest[id]
          if (!chunk) return
          if (/(^|\/)regal\.[^/]+\.js$/.test(chunk.file)) {
            throw new Error(`[regal] The app's entry loads the regal chunk up front (${[...path, id].join(' → ')}). Import Regal only through LazyShelfStage or LazyShelfRow.`)
          }
          for (const next of chunk.imports ?? []) walk(next, [...path, id])
        }
        walk(key, [])
      }
    })
  },
})
