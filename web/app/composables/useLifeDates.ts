import type { AuthorHero } from '~/data/enrich'

/** An author's life dates as her page and the Book page's author section say them ("1948 – 2015", "Born 1948", none). */
export function useLifeDates(author: () => Pick<AuthorHero, 'born' | 'died'> | null | undefined) {
  const { t } = useI18n()
  return computed(() => {
    const a = author()
    const s = a ? lifeSpan(a.born, a.died) : null
    if (!s) return null
    if (s.kind === 'span') return t('author.lived', { born: s.born, died: s.died })
    if (s.kind === 'born') return t('author.born', { year: s.born })
    return t('author.died', { year: s.died })
  })
}
