import type { ImportAmbient } from '~/utils/importProgress'

/**
 * What the import job says in words: the one line of the progress pill (components/shell/ImportStatus.vue) and of the import page's
 * progress, from `utils/importProgress.ts`. "Import done · 12 books added · 4 kept · 2 failed": the books that were there already
 * and the ones that failed only when there are some.
 */
export function useImportWords() {
  const { t } = useI18n()
  return (now: ImportAmbient): string => {
    switch (now.kind) {
      case 'queued':
        return t('import.ambient.queued', { count: now.ahead }, now.ahead)
      case 'matching':
      case 'covers':
      case 'writing':
        return t(`import.ambient.${now.kind}`, { done: now.done, total: now.total })
      case 'done':
        return [
          t('import.ambient.done', { count: now.added }, now.added),
          now.kept ? t('import.ambient.doneKept', { count: now.kept }) : '',
          now.failed ? t('import.ambient.doneFailed', { count: now.failed }) : '',
        ]
          .filter(Boolean)
          .join(' · ')
      default:
        return t(`import.ambient.${now.kind}`)
    }
  }
}
