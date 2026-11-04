import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUDDY_ERROR_CODES, isRetryableBuddyError, type BuddyErrorCode } from '@/data/buddyReads'
import { buddyErrorKey } from '@/utils/buddyRead'

/** Every refusal of a buddy read has a sentence (en.json, `buddyRead.error.<code>`); the German parity is tests/i18n-parity.test.ts. */
const en = JSON.parse(readFileSync(new URL('../i18n/locales/en.json', import.meta.url), 'utf8')) as { buddyRead: { error: Record<string, string> } }

describe('buddy read refusals have words', () => {
  const codes: BuddyErrorCode[] = [...BUDDY_ERROR_CODES, 'offline', 'busy', 'unknown']

  it.each(codes)('%s has a sentence under its key', (code) => {
    expect(buddyErrorKey(code)).toBe(`buddyRead.error.${code}`)
    expect(en.buddyRead.error[code], code).toMatch(/\S/)
  })

  it('has no sentence for a code that does not exist', () => {
    expect(Object.keys(en.buddyRead.error).filter((key) => !codes.includes(key as BuddyErrorCode))).toEqual([])
  })

  it('retries what a later try may cure and hands everything else back', () => {
    expect(codes.filter(isRetryableBuddyError).sort()).toEqual(['busy', 'message_rate_limited', 'offline', 'unknown'])
  })
})
