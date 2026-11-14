import { describe, expect, it } from 'vitest'
import { quoteOf, quotePreview, QUOTE_PREVIEW_MAX, replyChipOf, type QuoteSource, type QuoteWords, type ThreadItem } from '@/utils/roomThread'

/**
 * `utils/roomThread.ts`'s quote boundary on its own, without either page: the four shapes a quote comes from (`reply` among the items, and the
 * server's `hidden` / `removed` / `note` for a Book's notes), which of them carries an id to jump to, and the one preview rule both the quote and
 * the composer's chip cut their words with. The two threads' call sites are covered by tests/buddy-thread-view.test.ts and
 * tests/notes-thread-view.test.ts.
 */

const item = (id: string, over: Partial<ThreadItem> = {}): ThreadItem =>
  ({
    key: id,
    id,
    clientId: null,
    kind: 'text',
    body: '',
    createdAt: '2026-11-14T10:00:00.000Z',
    mine: false,
    authorId: 'ben',
    author: 'Ben',
    replyTo: null,
    removed: false,
    voice: false,
    permanent: false,
    reactions: [],
    myReaction: null,
    media: null,
    ...over,
  }) as unknown as ThreadItem

const words = { deleted: 'Message deleted', someone: 'A reader', you: 'You', voice: 'Voice message', hidden: 'A note you can’t see' }
const without = { deleted: 'Message deleted', someone: 'A reader', you: 'You' } satisfies QuoteWords
const items = [item('1', { body: 'First words' }), item('2', { mine: true, authorId: 'ada', author: 'Ada', body: 'Mine' })]
const note = (over: Partial<Extract<QuoteSource, { kind: 'note' }>> = {}): QuoteSource => ({ kind: 'note', id: '1', mine: false, author: 'Ben', excerpt: 'First words', voice: false, ...over })

describe('a quote over the server’s answer', () => {
  it('says a note she may not read is hidden, with no id to jump to and no name', () => {
    expect(quoteOf(items, { kind: 'hidden' }, words)).toEqual({ id: null, mine: false, name: '', preview: 'A note you can’t see' })
  })

  it('says a removed note is deleted, with no id to jump to', () => {
    expect(quoteOf(items, { kind: 'removed' }, words)).toEqual({ id: null, mine: false, name: '', preview: 'Message deleted' })
  })

  it('jumps to a note the server sent when it is among the items, and drops the jump when it is not', () => {
    expect(quoteOf(items, note(), words)).toEqual({ id: '1', mine: false, name: 'Ben', preview: 'First words' })
    expect(quoteOf(items, note({ id: 'far' }), words)).toEqual({ id: null, mine: false, name: 'Ben', preview: 'First words' })
  })

  it('names her own note "You", a nameless author "A reader", and a voice note as one with no words', () => {
    expect(quoteOf(items, note({ mine: true, author: 'Ada' }), words)).toMatchObject({ mine: true, name: 'You' })
    expect(quoteOf(items, note({ author: null }), words)).toMatchObject({ name: 'A reader' })
    expect(quoteOf(items, note({ voice: true, excerpt: '' }), words)).toMatchObject({ id: '1', preview: 'Voice message' })
  })

  it('has none when the message answers nothing', () => {
    expect(quoteOf(items, null, words)).toBeNull()
  })
})

describe('a quote over the items', () => {
  it('finds the message a reply names, its author and its first words on one line', () => {
    expect(quoteOf([...items, item('3', { body: '  The  ending\nwas great ' })], { kind: 'reply', replyTo: '3' }, words)).toEqual({ id: '3', mine: false, name: 'Ben', preview: 'The ending was great' })
    expect(quoteOf(items, { kind: 'reply', replyTo: '2' }, words)).toMatchObject({ id: '2', mine: true, name: 'You' })
  })

  it('has no id for a tombstone, and words the original it cannot find for the thread it is in', () => {
    expect(quoteOf([item('3', { removed: true })], { kind: 'reply', replyTo: '3' }, words)).toMatchObject({ id: null, preview: 'Message deleted' })
    // A Book's notes: the note it answers is outside the loaded page, so it is one she may not see.
    expect(quoteOf(items, { kind: 'reply', replyTo: 'gone' }, words)).toEqual({ id: null, mine: false, name: '', preview: 'A note you can’t see' })
    // A buddy read has no such shape: the message it answers was removed before this page was loaded.
    expect(quoteOf(items, { kind: 'reply', replyTo: 'gone' }, without)).toEqual({ id: null, mine: false, name: 'A reader', preview: 'Message deleted' })
  })
})

describe('the preview rule both the quote and the composer’s chip cut with', () => {
  const long = 'a'.repeat(QUOTE_PREVIEW_MAX + 40)

  it('is one line, trimmed, and no longer than the database’s own excerpt', () => {
    expect(quotePreview('  two  words\nhere ')).toBe('two words here')
    expect(quotePreview(long)).toBe('a'.repeat(QUOTE_PREVIEW_MAX))
    expect(QUOTE_PREVIEW_MAX).toBe(120)
    expect(quoteOf([item('1', { body: long })], { kind: 'reply', replyTo: '1' }, words)!.preview).toHaveLength(QUOTE_PREVIEW_MAX)
  })

  it('names and words the composer’s chip the same way the quote does', () => {
    expect(replyChipOf(item('2', { mine: true, authorId: 'ada', author: 'Ada', body: '  Mine\n' }), words)).toEqual({ name: 'You', preview: 'Mine' })
    expect(replyChipOf(item('3', { author: null, body: long }), words)).toEqual({ name: 'A reader', preview: 'a'.repeat(QUOTE_PREVIEW_MAX) })
    expect(replyChipOf(item('4', { voice: true, body: '' }), words)).toEqual({ name: 'Ben', preview: 'Voice message' })
  })
})
