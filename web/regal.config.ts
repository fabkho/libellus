import { join } from 'node:path'
import { defineNuxtModule } from 'nuxt/kit'

/**
 * Regal, the owner's 3D shelf (#23), as a Nuxt layer: where it comes from, and
 * how it is kept to the places that show it (Profile → Your shelf, its full
 * Stack, and the row in a year in review). Everything else in the app builds, loads and
 * precaches exactly as without it.
 *
 * Opt-in: only a build with LIBELLUS_REGAL=1 has it (the owner's Cloudflare Pages
 * build and CI). Without the flag the app builds and runs as it would for anyone
 * else: no layer, Your shelf's places are empty stand-ins (`ShelfStage`,
 * `ShelfRow` resolve to app/regal/Absent.vue) and nobody is the shelf's owner
 * (`appConfig.regal` is false, stores/shelf.ts).
 *
 * With the flag, where from, like the portfolio: a local checkout when
 * REGAL_LAYER is set (`REGAL_LAYER=/path/to/regal`), otherwise the default
 * branch of the private repo fabkho/regal, downloaded with the token in
 * GIGET_AUTH (a GitHub token that can read it; the Cloudflare Pages build and
 * CI have it), and the library file it shows in NUXT_PUBLIC_REGAL_LIBRARY_SRC.
 * Missing one of them, `nuxt dev` and `nuxt generate` stop with a message saying
 * so; only `nuxt prepare` (the postinstall) goes on without it, so an install
 * works anywhere.
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

/** Whether this build has Regal: LIBELLUS_REGAL=1 (or `true`). */
export const REGAL_ENABLED = /^(1|true)$/i.test(process.env.LIBELLUS_REGAL?.trim() ?? '')

/**
 * The published library file Regal shows (NUXT_PUBLIC_REGAL_LIBRARY_SRC; the owner's is the one
 * her portfolio shows, whose CORS allows Libellus). Empty without Regal.
 */
export const REGAL_LIBRARY_SRC = REGAL_ENABLED ? (process.env.NUXT_PUBLIC_REGAL_LIBRARY_SRC?.trim() ?? '') : ''

const MISSING = [
  'LIBELLUS_REGAL=1 builds Libellus with Regal (the owner\'s shelf, #23), and Regal could not be found.',
  'Set REGAL_LAYER to a checkout of fabkho/regal (REGAL_LAYER=/path/to/regal),',
  'or GIGET_AUTH to a GitHub token that can read the private repo fabkho/regal',
  '(the Cloudflare Pages build and CI read it from their secrets).',
  'Without LIBELLUS_REGAL the app builds without the shelf.',
].join('\n')

const NO_LIBRARY = [
  'LIBELLUS_REGAL=1 builds Libellus with Regal (the owner\'s shelf, #23), and it has no library file to show.',
  'Set NUXT_PUBLIC_REGAL_LIBRARY_SRC to the published file (https://…/v2/library.json).',
].join('\n')

/** `nuxt prepare` (the postinstall): types only, so it may go on without the layer. */
const isPrepare = () => process.argv.slice(2).includes('prepare')

/** The `extends` of nuxt.config.ts. */
export function regalLayer(): (string | [string, Record<string, unknown>])[] {
  const local = process.env.REGAL_LAYER?.trim()
  const auth = process.env.GIGET_AUTH?.trim()
  if (!REGAL_ENABLED) {
    if ((local || auth) && !isPrepare()) console.info('[regal] REGAL_LAYER or GIGET_AUTH is set, LIBELLUS_REGAL is not: building without the shelf.')
    return []
  }
  if (!REGAL_LIBRARY_SRC && !isPrepare()) throw new Error(`[regal] ${NO_LIBRARY}`)
  // A trailing slash: a folder, not a package name.
  if (local) return [local.replace(/\/?$/, '/')]
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
 * A service-worker route test for the library file and its images. Workbox copies each `urlPattern`
 * into sw.js as source text, so a closure would lose the address: the test is made from source with
 * the address written into it.
 */
function urlTest(body: string): (options: { url: URL; request: Request }) => boolean {
  // eslint-disable-next-line no-new-func
  return new Function('{ url, request }', body) as (options: { url: URL; request: Request }) => boolean
}

/**
 * The service worker's part (nuxt.config.ts, pwa.workbox): what it leaves out, and how it keeps it
 * once fetched. Without Regal nothing: no chunk, no file, no routes.
 */
export function regalAssets() {
  if (!REGAL_ENABLED || !REGAL_LIBRARY_SRC) return { globIgnores: [] as string[], runtimeCaching: [] }
  const href = JSON.stringify(new URL(REGAL_LIBRARY_SRC).href)
  const origin = JSON.stringify(new URL(REGAL_LIBRARY_SRC).origin)
  return {
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
        urlPattern: urlTest(`return url.href === ${href}`),
        handler: 'NetworkFirst' as const,
        options: { cacheName: 'libellus-shelf-library', networkTimeoutSeconds: 6, expiration: { maxEntries: 2 } },
      },
      {
        // Its images (fronts, Spines, backs, the pile's small copies), read with CORS as WebGL
        // textures, from the file's host. Cache first: a published image keeps its address. Bounded,
        // and the first to go.
        urlPattern: urlTest(
          `return url.origin === ${origin} && request.destination !== 'document' && /\\.(webp|jpe?g|png)$/.test(url.pathname)`,
        ),
        handler: 'CacheFirst' as const,
        options: {
          cacheName: 'libellus-shelf-images',
          expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90, purgeOnQuotaError: true },
        },
      },
    ],
  }
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

    // Without Regal the two components that draw it would import what isn't there (its
    // components, composables and the fonts' stylesheet): they resolve to an empty stand-in.
    // Nobody reaches them then anyway (appConfig.regal, stores/shelf.ts).
    if (!REGAL_ENABLED) {
      const absent = join(nuxt.options.srcDir, 'regal', 'Absent.vue')
      nuxt.hook('components:extend', (components) => {
        for (const component of components) {
          if (/[\\/]components[\\/]shelf[\\/](?:Stage|Row)\.vue$/.test(component.filePath)) component.filePath = absent
        }
      })
    }

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
