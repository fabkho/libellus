import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { QUEUED_ACTIONS } from '@/data/queuedWrites'

/**
 * Every write that can wait in the outbox is named in the Sync sheet ("Waiting" rows, "Couldn't sync: {action}"):
 * `sync.action.<action>` in both message files. An action added to `QUEUED_ACTIONS` without its copy would show the
 * raw key there (#485 added `set_progress_day` and `delete_progress_day` without it).
 */
const read = (name: string) => JSON.parse(readFileSync(new URL(`../i18n/locales/${name}.json`, import.meta.url), 'utf8')) as { sync: { action: Record<string, unknown> } }

describe.each(['en', 'de'])('the Sync sheet\'s names for the outbox actions, %s', (locale) => {
  const names = read(locale).sync.action

  it.each([...QUEUED_ACTIONS])('%s has sync.action.%s', (action) => {
    expect(typeof names[action], `sync.action.${action} is missing in ${locale}.json`).toBe('string')
    expect((names[action] as string).trim()).not.toBe('')
  })

  it('names no action the outbox does not have', () => {
    expect(Object.keys(names).filter((name) => !(QUEUED_ACTIONS as readonly string[]).includes(name))).toEqual([])
  })
})
