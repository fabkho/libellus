import type { ProgressValue } from '~/data/progress'
import { progressPercentOf } from '~/data/progress'

/**
 * How far a member is, in words (issue #39): "p. 212 of 480" for a page of a
 * Book with a page count, "p. 212" for a page without one, "45 %" for a
 * percentage; `percent` is the same place as a whole percent when it can be
 * known (a page against its page count), else null.
 */
export function useProgressText() {
  const { t } = useI18n()
  return (progress: ProgressValue | null, pageCount: number | null) => {
    const percent = progressPercentOf(progress, pageCount)
    if (!progress) return { value: t('book.progress.none'), percent }
    if ('percent' in progress) return { value: t('book.progress.percent', { percent: progress.percent }), percent }
    return {
      value: pageCount ? t('book.progress.page', { page: progress.page, count: pageCount }) : t('book.progress.pageOnly', { page: progress.page }),
      percent,
    }
  }
}
