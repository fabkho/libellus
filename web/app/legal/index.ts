import { IMPRINT } from './imprint'
import { PRIVACY } from './privacy'
import type { LegalBlock, LegalDocument, LegalLang, LegalPage } from './types'
import { LEGAL_LANGS } from './types'
import { placeholdersIn } from '../utils/legalInline'

export const LEGAL_DOCUMENTS: Record<LegalPage, LegalDocument> = { privacy: PRIVACY, imprint: IMPRINT }

/** The text's language: `?lang=` when it names one, else the device's first listed language when German, else English. */
export function legalLangOf(query: unknown, languages: readonly string[]): LegalLang {
  const asked = Array.isArray(query) ? query[0] : query
  if (typeof asked === 'string' && (LEGAL_LANGS as readonly string[]).includes(asked)) return asked as LegalLang
  return languages[0]?.toLowerCase().startsWith('de') ? 'de' : 'en'
}

const blockText = (block: LegalBlock): string[] => ('p' in block ? [block.p] : 'ul' in block ? block.ul : block.lines)

/** Every placeholder still in a document, in both languages, once each. */
export function placeholdersOf(document: LegalDocument): string[] {
  const texts = LEGAL_LANGS.flatMap((lang) => {
    const text = document[lang]
    return [text.title, text.lead, ...text.sections.flatMap((section) => [section.heading, ...section.blocks.flatMap(blockText)])]
  })
  return [...new Set(texts.flatMap(placeholdersIn))]
}

/** Every placeholder on either page: what docs/legal-checklist.md lists. */
export const allPlaceholders = (): string[] => [...new Set(Object.values(LEGAL_DOCUMENTS).flatMap(placeholdersOf))]
