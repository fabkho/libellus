import type { WorkCard } from '~/data/enrich/works'

/**
 * What an author page makes of the works the database hands it (Wave C5): the
 * standalone works split by what they are. Pure and framework-free, so
 * `tests/author-page.test.ts` drives them in plain Node.
 */

/** The kinds `work_card` gives a work; a work without one says none. */
export type WorkKind = NonNullable<WorkCard['kind']>

/**
 * The standalone works, split the way the page draws them: the novels first, then the novellas, then anything else the
 * group may hold. `author_page` puts only novels and novellas in `standalone` (every other kind is `other`), so `rest` is
 * empty today; it exists so a kind the database starts sending lands in a group instead of vanishing from the page.
 */
export type StandaloneGroups = { novels: WorkCard[]; novellas: WorkCard[]; rest: WorkCard[] }

export function standaloneByKind(works: readonly WorkCard[]): StandaloneGroups {
  const groups: StandaloneGroups = { novels: [], novellas: [], rest: [] }
  for (const work of works) {
    if (work.kind === 'novel') groups.novels.push(work)
    else if (work.kind === 'novella') groups.novellas.push(work)
    else groups.rest.push(work)
  }
  return groups
}
