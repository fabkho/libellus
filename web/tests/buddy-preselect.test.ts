import { describe, expect, it } from 'vitest'
import { bookWith, preselected, withParam } from '@/utils/buddyPreselect'

/** The friend a "Potential buddy reads" cover names (`?with=`): read as one id or nothing (utils/buddyPreselect.ts). */

const ME = '11111111-1111-4111-8111-111111111111'
const IDA = '22222222-2222-4222-8222-222222222222'
const NINA = '33333333-3333-4333-8333-333333333333'
const BLOCKED = '44444444-4444-4444-8444-444444444444'
const STRANGER = '55555555-5555-4555-8555-555555555555'
const offered = [IDA, NINA]

describe('withParam', () => {
  it('takes one member id, in either case', () => {
    expect(withParam(IDA)).toBe(IDA)
    expect(withParam(IDA.toUpperCase())).toBe(IDA)
  })

  it('ignores anything that is not one id: nothing, text, a repeated parameter, a list', () => {
    for (const value of [undefined, null, '', 'ida', '123', `${IDA}x`, ` ${IDA}`, [IDA, NINA], [IDA], {}, 5]) expect(withParam(value)).toBeNull()
  })
})

describe('preselected', () => {
  it('ticks a friend the picker would offer', () => {
    expect(preselected(IDA, { offered, leave: [ME] })).toBe(IDA)
    expect(preselected(NINA.toUpperCase(), { offered, leave: [ME] })).toBe(NINA)
  })

  it('ignores an id she does not follow (an unknown one, a stranger)', () => {
    expect(preselected(STRANGER, { offered, leave: [ME] })).toBeNull()
    expect(preselected(IDA, { offered: [], leave: [ME] })).toBeNull()
  })

  it('ignores her own id, even if it were offered, and a blocked member', () => {
    expect(preselected(ME, { offered: [...offered, ME], leave: [ME] })).toBeNull()
    expect(preselected(BLOCKED, { offered: [...offered, BLOCKED], leave: [ME, BLOCKED] })).toBeNull()
    expect(preselected(IDA, { offered, leave: [null, undefined] })).toBe(IDA)
  })

  it('ignores a parameter given twice, whichever it names', () => {
    expect(preselected([IDA, NINA], { offered })).toBeNull()
    expect(preselected([IDA, IDA], { offered })).toBeNull()
  })
})

describe('bookWith', () => {
  it("is the Book's address with the friend after it, which the parameter's reader takes back", () => {
    const address = bookWith('abc', IDA)
    expect(address).toBe(`/book/abc?with=${IDA}`)
    expect(withParam(new URL(address, 'https://x.test').searchParams.get('with'))).toBe(IDA)
  })
})
