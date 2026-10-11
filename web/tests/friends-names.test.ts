import { describe, expect, it } from 'vitest'
import { friendsNameParts } from '../app/utils/friendsNames'

describe('friendsNameParts', () => {
  it('names one, two and three members in full', () => {
    expect(friendsNameParts(['Anna'], 0)).toMatchObject({ key: 'one', args: { a: 'Anna' }, count: 1 })
    expect(friendsNameParts(['Anna', 'Ben'], 0)).toMatchObject({ key: 'two', args: { a: 'Anna', b: 'Ben' }, count: 2 })
    expect(friendsNameParts(['Anna', 'Ben', 'Cleo'], 0)).toMatchObject({ key: 'three', args: { a: 'Anna', b: 'Ben', c: 'Cleo' }, count: 3 })
  })

  it('says the first two and the count of the rest once there are more than three', () => {
    expect(friendsNameParts(['Anna', 'Ben', 'Cleo'], 1)).toMatchObject({ key: 'others', args: { a: 'Anna', b: 'Ben', count: 2 }, count: 2 })
    expect(friendsNameParts(['Anna', 'Ben', 'Cleo'], 2)).toMatchObject({ key: 'others', args: { a: 'Anna', b: 'Ben', count: 3 }, count: 3 })
  })
})
