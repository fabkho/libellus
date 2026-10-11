/**
 * The legal pages' texts (docs/legal-checklist.md): a privacy notice and an imprint, each in English and
 * German on the same page. The German i18n catalogue does not exist yet (issue #257), so these two
 * documents carry their own text instead of keys in `i18n/locales/`. A DRAFT for the owner, and ideally a
 * lawyer, to review: it is not legal advice.
 *
 * A paragraph is a plain string with three bits of markup (`utils/legalInline.ts`): `**bold**`,
 * `[label](href)` (a path inside the app, `mailto:` or an https address) and `[[PLACEHOLDER]]`, a detail
 * only the owner can supply, drawn marked so it cannot be missed.
 */
export type LegalBlock =
  | { p: string }
  | { ul: string[] }
  /** Lines that belong together (a postal address), one under the other. */
  | { lines: string[] }

export interface LegalSection {
  id: string
  heading: string
  blocks: LegalBlock[]
}

export interface LegalText {
  /** The page's title: its heading, the document's title. */
  title: string
  /** One short paragraph under the title. */
  lead: string
  sections: LegalSection[]
  /** "Version: 11 October 2026". */
  version: string
}

export type LegalLang = 'en' | 'de'
export const LEGAL_LANGS: readonly LegalLang[] = ['en', 'de']

export type LegalPage = 'privacy' | 'imprint'
export type LegalDocument = Record<LegalLang, LegalText>
