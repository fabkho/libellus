import { addVitePlugin, defineNuxtModule } from 'nuxt/kit'

/**
 * The entry must never carry the real Realtime client. supabase-js builds one in every client, so `@supabase/realtime-js` is
 * aliased to a stub (realtime.config.ts, app/data/realtimeStub.ts) and the real one is imported only by the import job's live
 * feed, as `#realtime-client`, into its own chunk (`realtime`, nuxt.config.ts, codeSplitting). The client and the Phoenix socket
 * under it are ~95 KB unminified, in every member's first download if one import slips past the stub: a layer's file, a new
 * dependency, a static `import ... from '#realtime-client'`, or `realtime` among what the entry imports statically.
 *
 * The check: the production build's client bundle, from the entry chunks (`isEntry`) along their static imports, which is
 * what `index.html` loads (its script and its modulepreload links; a dynamic import is not followed). Any chunk of that
 * set that holds a module of `@supabase/realtime-js` or `@supabase/phoenix`, or is the `realtime` chunk, fails the build, with the
 * path that pulled it in. The stub is not such a module. `perf/bundle.ts` prints the entry's files: the second check, by eye.
 */
const REAL_REALTIME = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?@supabase[\\/](?:realtime-js|phoenix)[\\/]/

type Chunk = { type: 'chunk'; fileName: string; name: string; isEntry: boolean; imports: string[]; modules: Record<string, unknown> }

/** The first path from an entry to a chunk that holds the real client, or null. Pure, so the test can exercise it. */
export function findRealtimeInEntry(bundle: Record<string, { type: string }>): { path: string[]; modules: string[] } | null {
  const chunks = new Map(Object.values(bundle).filter((c): c is Chunk => c.type === 'chunk').map((c) => [c.fileName, c]))
  for (const entry of [...chunks.values()].filter((c) => c.isEntry)) {
    const seen = new Set<string>()
    const walk = (file: string, path: string[]): { path: string[]; modules: string[] } | null => {
      if (seen.has(file)) return null
      seen.add(file)
      const chunk = chunks.get(file)
      if (!chunk) return null
      const modules = Object.keys(chunk.modules).filter((id) => REAL_REALTIME.test(id))
      if (modules.length || chunk.name === 'realtime') return { path: [...path, file], modules }
      for (const next of chunk.imports) {
        const hit = walk(next, [...path, file])
        if (hit) return hit
      }
      return null
    }
    const hit = walk(entry.fileName, [])
    if (hit) return hit
  }
  return null
}

export const entryGuard = defineNuxtModule({
  meta: { name: 'libellus-entry-guard' },
  setup() {
    addVitePlugin({
      name: 'libellus-entry-guard',
      // The browser's bundle only: a server build (none for an SPA, but a layer could add one) loads what it likes.
      applyToEnvironment: (environment: { name: string }) => environment.name === 'client',
      generateBundle(_options: unknown, bundle: Record<string, { type: string }>) {
        const hit = findRealtimeInEntry(bundle)
        if (!hit) return
        const held = hit.modules.length ? ` (${hit.modules.slice(0, 3).map((id) => id.replace(/^.*node_modules\//, '')).join(', ')}${hit.modules.length > 3 ? ', …' : ''})` : ''
        throw new Error(
          `[realtime] The app's entry loads the real Realtime client up front: ${hit.path.join(' → ')} holds @supabase/realtime-js${held}. ` +
            `Only the stub belongs in the entry; import the real client through \`import('#realtime-client')\` from data/importJobFeed.ts (realtime.config.ts).`,
        )
      },
    })
  },
})
