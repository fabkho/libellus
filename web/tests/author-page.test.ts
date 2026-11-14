import { describe, expect, it } from 'vitest'
import type { WorkCard } from '@/data/enrich/works'
import { standaloneByKind } from '@/utils/authorPage'

/**
 * What the author page makes of its works (Wave C5): the standalone group split by what a work is. The page's template
 * only draws what this says, so the split is tested here rather than end to end.
 */

const work = (title: string, extra: Partial<WorkCard> = {}): WorkCard => ({ title, ...extra })

describe('standaloneByKind', () => {
  it('puts the novels first, then the novellas, then anything else; the order within a group is the one it was given', () => {
    const groups = standaloneByKind([
      work('A novella', { kind: 'novella' }),
      work('A novel', { kind: 'novel' }),
      work('Another novel', { kind: 'novel' }),
      work('No kind at all'),
    ])
    expect(groups.novels.map((w) => w.title)).toEqual(['A novel', 'Another novel'])
    expect(groups.novellas.map((w) => w.title)).toEqual(['A novella'])
    expect(groups.rest.map((w) => w.title)).toEqual(['No kind at all'])
  })

  it('leaves the groups empty when there is nothing of that kind', () => {
    expect(standaloneByKind([work('Only a novel', { kind: 'novel' })])).toEqual({ novels: [expect.anything()], novellas: [], rest: [] })
    expect(standaloneByKind([])).toEqual({ novels: [], novellas: [], rest: [] })
  })

  it('does not change the list it is given', () => {
    const list = [work('A', { kind: 'novella' }), work('B', { kind: 'novel' })]
    standaloneByKind(list)
    expect(list.map((w) => w.title)).toEqual(['A', 'B'])
  })
})
