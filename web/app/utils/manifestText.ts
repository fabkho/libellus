/**
 * The web app manifest in German (German group B of #257). A manifest is one static file with no
 * per-language members: `name` and `short_name` are the brand (the same in both languages), but its
 * `description` and the three launcher shortcuts' names ("Search", "Update progress", "Library", shown when
 * the installed icon is long-pressed on Android) are words. The browser asks for the manifest with its own
 * `Accept-Language`, at install and at every update check, so `functions/manifest.webmanifest.js` answers a
 * German browser with this text and everyone else with the file as built. No imports: the Pages Function and
 * the tests both import it.
 */

/** Whether the first language the request asks for that the app speaks is German (`de`, `de-AT`, …; `en` is not). */
export function prefersGerman(acceptLanguage: string | null | undefined): boolean {
  const ranked = String(acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';')
      const q = params.map((param) => /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(param)?.[1]).find(Boolean)
      return { primary: tag.trim().toLowerCase().split(/[-_]/)[0], q: q === undefined ? 1 : Number(q), index }
    })
    .filter((entry) => entry.primary && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  return ranked.find((entry) => entry.primary === 'de' || entry.primary === 'en')?.primary === 'de'
}

const DESCRIPTION = 'Deine Bücher: was du lesen möchtest, was du gerade liest und was du gelesen hast.'

/** The shortcuts by their address (`url`), the key the manifest and the app (composables/useLaunch.ts) use. */
const SHORTCUTS: Record<string, { name: string; short_name: string; description: string }> = {
  '/?search=1': { name: 'Suche', short_name: 'Suche', description: 'Ein Buch zum Hinzufügen finden' },
  '/?progress=1': { name: 'Fortschritt aktualisieren', short_name: 'Fortschritt', description: 'Das Buch aktualisieren, das du gerade liest' },
  '/library': { name: 'Bibliothek', short_name: 'Bibliothek', description: 'Deine Bücher' },
}

type Manifest = { lang?: string; description?: string; shortcuts?: { url?: string; name?: string; short_name?: string; description?: string }[] }

/** The manifest as built, with its words in German; what it has no German for (a new shortcut) stays as it is. */
export function germanManifest<T extends Manifest>(manifest: T): T {
  return {
    ...manifest,
    lang: 'de',
    description: DESCRIPTION,
    shortcuts: manifest.shortcuts?.map((shortcut) => ({ ...shortcut, ...(shortcut.url ? SHORTCUTS[shortcut.url] : undefined) })),
  }
}
