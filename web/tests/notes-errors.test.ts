import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isRetryableNoteError, NOTE_ERROR_CODES, type NoteErrorCode } from '@/data/notes'
import { noteErrorKey } from '@/utils/notes'

/** Every refusal of the notes functions has a sentence (en.json, `notes.error.<code>`); the German parity is tests/i18n-parity.test.ts. */
const en = JSON.parse(readFileSync(new URL('../i18n/locales/en.json', import.meta.url), 'utf8')) as { notes: { error: Record<string, string> } }

describe('notes refusals have words', () => {
  const codes: NoteErrorCode[] = [...NOTE_ERROR_CODES, 'offline', 'busy', 'unknown']

  it.each(codes)('%s has a sentence under its key', (code) => {
    expect(noteErrorKey(code)).toBe(`notes.error.${code}`)
    expect(en.notes.error[code], code).toMatch(/\S/)
  })

  it('has no sentence for a code that does not exist', () => {
    expect(Object.keys(en.notes.error).filter((key) => !codes.includes(key as NoteErrorCode))).toEqual([])
  })

  it('retries what a later try may cure and hands everything else back', () => {
    expect(codes.filter(isRetryableNoteError).sort()).toEqual(['busy', 'offline', 'rate_limited', 'unknown'])
  })
})
