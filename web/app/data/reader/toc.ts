/**
 * The book's own structure, as the reader needs it (#131 phase 2): where the
 * *body* ends, and the table of contents flattened to one list of rows.
 *
 * Two things the reader does not show as the file has them:
 *
 * - **The body's end.** A Project Gutenberg EPUB carries the licence as a
 *   section after the book. "The end" (and the fraction progress is a share of)
 *   stops before the first back-matter section after the last real one.
 * - **The contents.** foliate hands a tree; the reader draws one level with a
 *   `depth` per row, and leaves out the back matter's own entries — the licence
 *   is not a chapter a member wants to jump to.
 *
 * Framework-free: the book comes in as the three things this reads (`sections`,
 * `toc`, `resolveHref`), never as a foliate view, so Vitest drives it in plain
 * Node and a native port reimplements it 1:1.
 */

/** One row of the reader's contents. */
export interface TocItem {
  label: string
  href: string
  depth: number
  /** Where it starts, 0–1 of the body (for the page number in the Contents sheet). */
  fraction: number | null
}

/** Back matter that is not the book: Project Gutenberg's licence, and similar footers. */
export const BACK_MATTER = /footer|licen[cs]e|colophon|imprint|uncopyright/i

/** A contents entry as the book gives it (foliate's `toc`, subitems and all). */
export interface TocEntry {
  label: string
  href: string
  subitems?: unknown[]
}

/** What the contents flattening reads of the book. */
export interface TocSource {
  toc?: readonly TocEntry[] | null
  /** An href as a section index, or null when it points nowhere in the book. */
  resolveHref: (href: string) => { index: number } | null
}

/** What the body's end reads of the book. */
export interface SectionSource {
  sections: readonly { id: string; linear?: string; size: number }[]
}

/** Where the body ends, as the reader's two numbers: the last body section, and the fraction the body is of the file. */
export interface BodyEnd {
  /** The last section that is the book's own. */
  index: number
  /** The body's share of the file, 0–1: where back matter begins (1 when there is none). */
  fraction: number
}

/** The last section that is the book's own: the first back-matter (or non-linear) section ends it (see `BACK_MATTER`). */
export function findBodyEnd(sections: readonly SectionSource['sections'][number][], sectionFractions: readonly number[]): BodyEnd {
  let index = sections.length - 1
  while (index > 0 && (BACK_MATTER.test(sections[index]!.id) || sections[index]!.linear === 'no')) index--
  return { index, fraction: sectionFractions[index + 1] ?? 1 }
}

/**
 * The table of contents as one list: each entry with its depth, its start as a
 * fraction of the body, and the back matter's own entries left out (a licence
 * or a colophon, wherever it sits in the tree, and its children with it).
 */
export function flattenToc(book: TocSource, sectionFractions: readonly number[], bodyEnd: number): TocItem[] {
  const flat: TocItem[] = []
  const walk = (items: readonly TocEntry[] | null | undefined, depth: number) => {
    for (const item of items ?? []) {
      const label = (item.label ?? '').trim()
      if (BACK_MATTER.test(label) || /project gutenberg/i.test(label)) continue
      let fraction: number | null = null
      try {
        const resolved = book.resolveHref(item.href)
        if (resolved) fraction = Math.min(1, (sectionFractions[resolved.index] ?? 0) / bodyEnd)
      } catch {
        fraction = null
      }
      flat.push({ label, href: item.href, depth, fraction })
      walk(item.subitems as readonly TocEntry[] | undefined, depth + 1)
    }
  }
  walk(book.toc, 0)
  return flat
}
