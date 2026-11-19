import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { formatAuthors } from '#layers/ui/app/utils/cloth'
import type { LibraryEntry } from '~/data/library'
import { pageCountOf, progressOf, progressPercentOf, type ProgressValue } from '~/data/progress'
import { statusOf, type StatusView } from '~/utils/bookStatus'
import { coverImage, type CoverBook, type CoverHosts, type CoverImage } from '~/utils/coverRef'
import type { CoverSize } from '~/utils/cover'

/**
 * What one row of a shelf says (docs/parity.md, Library and Search): its cover, its title, its author, its Status and
 * its progress — the five things EntryRow, ResultRow and the reading page's CoverRow each assembled by hand. The
 * pieces themselves already live in one place and stay there: the image is `coverImage` (utils/coverRef.ts, the cover
 * view model), the words are the message file's through `statusOf` (utils/bookStatus.ts) and `useProgressText`, and
 * the percent is `progressPercentOf` (data/progress.ts). This only picks them for a row.
 *
 * **Inputs only.** Whatever decided *which* Book a row shows — `shownBook` for a shelf cover, a search hit, an entry's
 * own Book — hands the result in (`book`); nothing here re-decides identity, and nothing here holds app state: the
 * hosts and the words come in as arguments, with the build's own as their defaults.
 *
 * ```ts
 * const { title, author, status, progress } = useShelfRow(() => props.entry.book, () => props.entry, 'sm', coverHosts)
 * ```
 *
 * `shelfRowOf` is the same thing without reactivity, for a screen that draws many rows in one pass (the reading page's
 * CoverRow): it hands back plain values, so no reactive effect is made per Book.
 */

/** A Book as a row shows it: what the title, the author and the cover are read from. */
export type ShelfBook = CoverBook & { title: string; authors: readonly string[] }

/** How a progress reads, and where it stands as a whole percent: `useProgressText`'s answer (`progressPercentOf`'s). */
export type ShelfRowProgress = { value: string; percent: number | null }

/** The wording function `useProgressText` hands out: a progress and its page count, in words. */
export type ProgressWords = (progress: ProgressValue | null, pageCount: number | null) => ShelfRowProgress

/**
 * The words a row needs from outside itself: the progress wording, and the message file's "et al" — a getter, so the
 * app's language is read where the row is built (a switch of language words the rows again, as the rest of the screen).
 */
export type ShelfRowWords = { progress: ProgressWords; etAl: () => string }

/** One row, as plain values. */
export type ShelfRowValues = {
  cover: CoverImage
  title: string
  author: string
  /** null for a Book that is not in her Library (a catalogue-only Book has no shelf state). */
  status: StatusView | null
  progress: ShelfRowProgress
}

/** The same five, kept up to date with what the screen holds. */
export type ShelfRow = {
  cover: ComputedRef<CoverImage>
  title: ComputedRef<string>
  author: ComputedRef<string>
  status: ComputedRef<StatusView | null>
  progress: ComputedRef<ShelfRowProgress>
}

/** How an entry stands on the shelf, or null when there is no entry: `statusOf`, with the read that decides it. */
export function shelfStatusOf(entry: LibraryEntry | null | undefined): StatusView | null {
  return entry ? statusOf(entry, entry.latestSession) : null
}

/**
 * How far the entry is, in words, and the percent for a bar: the latest read's progress against the page count that
 * counts for the entry (her own total, else the edition's, `pageCountOf`). A Book with no entry — a search result, a
 * catalogue-only Book — has none, so the words are the ones for a read not started and the percent is null.
 */
export function shelfProgressOf(entry: LibraryEntry | null | undefined, words: ProgressWords): ShelfRowProgress {
  const progress = progressOf(entry?.latestSession)
  const pageCount = entry ? pageCountOf(entry) : null
  return { value: words(progress, pageCount).value, percent: progressPercentOf(progress, pageCount) }
}

/** One row of a shelf, for a Book and the member's entry in it (none for a catalogue-only Book). */
export function shelfRowOf(
  book: ShelfBook | null | undefined,
  entry: LibraryEntry | null | undefined,
  size: CoverSize,
  hosts: CoverHosts,
  words: ShelfRowWords,
): ShelfRowValues {
  return {
    cover: coverImage(book, size, hosts),
    title: book?.title ?? '',
    author: formatAuthors(book?.authors ?? [], words.etAl()),
    status: shelfStatusOf(entry),
    progress: shelfProgressOf(entry, words.progress),
  }
}

export function useShelfRow(
  book: MaybeRefOrGetter<ShelfBook | null | undefined>,
  entry: MaybeRefOrGetter<LibraryEntry | null | undefined> = null,
  size: MaybeRefOrGetter<CoverSize> = 'sm',
  hosts: CoverHosts = useCoverHosts(),
): ShelfRow {
  const { t } = useI18n()
  const words: ShelfRowWords = { progress: useProgressText(), etAl: () => t('common.etAl') }
  const row = computed(() => shelfRowOf(toValue(book), toValue(entry), toValue(size), hosts, words))

  return {
    cover: computed(() => row.value.cover),
    title: computed(() => row.value.title),
    author: computed(() => row.value.author),
    status: computed(() => row.value.status),
    progress: computed(() => row.value.progress),
  }
}
