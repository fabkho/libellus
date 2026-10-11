import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineI18nKitConfig } from '@the-i18n-kit/cli/config'

// Policy for the-i18n-kit (https://github.com/fabkho/the-i18n-kit): how Libellus is translated.
// The words live in i18n/kit/ so a person can read and correct them without reading code:
//   ai-context.md  the voice and the rules the model gets as its system prompt
//   glossary.json  terms to keep and the German words to use
//   examples.json  a few approved pairs the model imitates
// docs/i18n/README.md says how to run it. The API key never comes from a file: GEMINI_API_KEY.
const kit = join(dirname(fileURLToPath(import.meta.url)), 'i18n', 'kit')
const read = (file: string) => readFileSync(join(kit, file), 'utf8')
const glossary = JSON.parse(read('glossary.json')) as {
  preserve: string[]
  terms: Record<string, { de: string, note?: string }>
}
const examples = JSON.parse(read('examples.json')) as Array<{ key: string, de: string, note?: string }>

export default defineI18nKitConfig({
  // Not the Nuxt adapter: that one boots the whole app (and its Supabase env) to read one locale folder.
  framework: 'generic',
  localeDirs: ['i18n/locales'],
  defaultLocale: 'en',
  locales: ['en', 'de'],
  localeFileFormat: 'json',

  context: 'Libellus is a calm, invite-only PWA for keeping track of the books you read: Library, Want to read, Currently reading, Finished, reading history, ratings, Collections, a small circle of friends. Every string is a short mobile UI label, button, sheet title, empty state or error message.',
  translationPrompt: read('ai-context.md'),
  localeNotes: {
    de: 'German (Germany), informal "du" (never "Sie"), warm and plain, German is 20-30 % longer than English so choose short words. Typographic quotes „…“ and ‚…‘.',
  },
  glossary: {
    ...Object.fromEntries(glossary.preserve.map(term => [term, 'Keep exactly as written. Never translate, never inflect.'])),
    ...Object.fromEntries(Object.entries(glossary.terms).map(([term, { de, note }]) => [term, `${de}${note ? ` (${note})` : ''}`])),
  },
  examples: examples.map(({ key, de, note }) => ({ key, de, ...(note ? { note } : {}) })),
})
