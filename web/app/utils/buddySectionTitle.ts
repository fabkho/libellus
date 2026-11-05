import { numberedTitle } from '#layers/chat/app/utils/chapters'

/**
 * A Section's name in the VIEWER's language. The host's setup writes each Section's label as stored text in her own language ("Section 3",
 * "Abschnitt 3–4", "The whole book"), and the other readers may read another: so a label that is the setup's own is worded again from the
 * message file here, and only one the host typed herself is shown as she wrote it. The whole book is always the viewer's own words.
 * Pure (no i18n, no store): the words come in.
 */

/** What the setup writes for a Section of a division (`together.setup.sections.label` in each language the app has), with `{n}` for the number. */
export const DEFAULT_SECTION_FORMATS: readonly string[] = ['Section {n}', 'Abschnitt {n}']

export type SectionWords = {
  /** "The whole book". */
  whole: () => string
  /** "Section 3" or "Section 3–4": `n` is what the stored label carried. */
  label: (n: string) => string
}

export function sectionTitle(chapter: { kind: 'chapter' | 'end'; title: string }, words: SectionWords): string {
  if (chapter.kind === 'end') return words.whole()
  for (const format of DEFAULT_SECTION_FORMATS) {
    const n = numberedTitle(chapter.title, format)
    if (n !== null) return words.label(n)
  }
  return chapter.title
}
