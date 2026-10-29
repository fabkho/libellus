import { describe, expect, it } from 'vitest'
import { createVisibleWarmBudget, friendIdOfHref } from '../app/utils/friendWarm'

const ID = '7d85d035-e700-4a51-8a17-fc789b45f847'

describe('friendIdOfHref', () => {
  it('names the friend a link leads to', () => {
    expect(friendIdOfHref(`/friends/${ID}`)).toBe(ID)
    expect(friendIdOfHref(`/friends/${ID}/`)).toBe(ID)
    expect(friendIdOfHref(`/friends/${ID.toUpperCase()}?from=feed`)).toBe(ID)
  })
  it('knows no other address: the tab, her year pages, other screens, nothing', () => {
    for (const href of ['/friends', '/friends/people', `/friends/${ID}/2025`, `/book/${ID}`, `https://x.test/friends/${ID}`, '', null, undefined]) {
      expect(friendIdOfHref(href)).toBeNull()
    }
  })
})

describe('createVisibleWarmBudget', () => {
  it('lets a few friends be warmed by a screen, each once', () => {
    const budget = createVisibleWarmBudget(2)
    expect(budget.take('a')).toBe(true)
    expect(budget.take('a')).toBe(false)
    expect(budget.take('b')).toBe(true)
    expect(budget.take('c')).toBe(false)
    expect(budget.used).toBe(2)
  })
})
