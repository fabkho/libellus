import { describe, expect, it } from 'vitest'
import {
  authorKey,
  friendShowsAnything,
  suggestBuddyReads,
  SUGGESTIONS_MAX,
  workKey,
  type FriendShown,
  type MineShown,
  type SuggestionBook,
  type SuggestionInput,
} from '@/utils/buddySuggestions'

/**
 * Potential buddy reads (utils/buddySuggestions.ts): the ranking and the rules about what is never suggested, as a pure function (plain Node).
 * What the friend hides arrives as `null`, and the function never has anything else of hers than what her profile shows.
 */

let next = 0
const book = (title: string, author = 'Somebody Else', over: Partial<SuggestionBook> = {}): SuggestionBook => ({
  id: `id-${++next}-${title}`,
  title,
  authors: [author],
  ...over,
})

const none: MineShown = { want: [], reading: [], finished: [] }
const hidden: FriendShown = { want: null, reading: null, done: null }
const input = (over: { mine?: Partial<MineShown>; friend?: Partial<FriendShown>; together?: SuggestionInput['together'] } = {}): SuggestionInput => ({
  mine: { ...none, ...over.mine },
  friend: { ...hidden, ...over.friend },
  together: over.together ?? [],
})
const titles = (result: ReturnType<typeof suggestBuddyReads>) => result.map((s) => s.book.title)
const reasons = (result: ReturnType<typeof suggestBuddyReads>) => result.map((s) => s.reason.kind)

describe('what ranks first', () => {
  it('puts the Books on both want-to-read lists first, then one that is read while the other wants it, then taste', () => {
    const dune = book('Dune', 'Frank Herbert')
    const emma = book('Emma', 'Jane Austen')
    const ulysses = book('Ulysses', 'James Joyce')
    const persuasion = book('Persuasion', 'Jane Austen')
    const result = suggestBuddyReads(
      input({
        mine: {
          want: [book('Ulysses', 'James Joyce', { id: 'mine-ulysses' }), dune],
          reading: [emma],
          finished: [{ book: book('Northanger Abbey', 'Jane Austen') }],
        },
        friend: { want: [persuasion, emma, ulysses, dune], reading: [book('Hamlet', 'William Shakespeare')], done: [] },
      }),
    )
    // Both want: in the friend's order (Ulysses, then Dune); Emma: she is reading it and the friend wants it; Persuasion: Austen she has read.
    expect(titles(result)).toEqual(['Ulysses', 'Dune', 'Emma', 'Persuasion'])
    expect(reasons(result)).toEqual(['both_want', 'both_want', 'you_reading', 'author_yours'])
  })

  it("suggests her own copy of a Book she has (her edition, her cover), and the friend's for one she has not", () => {
    const hers = book('Piranesi', 'Susanna Clarke', { id: 'her-edition', coverUrl: 'https://covers.test/hers.jpg' })
    const theirs = book('Piranesi', 'Susanna Clarke', { id: 'their-edition', coverUrl: 'https://covers.test/theirs.jpg' })
    const [first] = suggestBuddyReads(input({ mine: { want: [hers] }, friend: { want: [theirs], done: [] } }))
    expect(first!.book.id).toBe('her-edition')
    const [other] = suggestBuddyReads(
      input({ mine: { finished: [{ book: book('Jonathan Strange', 'Susanna Clarke') }] }, friend: { want: [theirs], done: [] } }),
    )
    expect(other!.book.id).toBe('their-edition')
    expect(other!.reason).toEqual({ kind: 'author_yours', author: 'Susanna Clarke' })
  })

  it('takes the same Book in another edition for the same Book (title and first author), and a Book once however many lists name it', () => {
    const a = book('The Name of the Rose', 'Umberto Eco')
    const b = book('The name of the rose!', 'Eco, Umberto')
    const result = suggestBuddyReads(input({ mine: { want: [a], reading: [] }, friend: { want: [b], reading: [b], done: [] } }))
    expect(result).toHaveLength(1)
    expect(result[0]!.reason.kind).toBe('both_want')
    expect(workKey(a)).toBe(workKey(b))
    expect(authorKey('Clarke, Susanna')).toBe(authorKey('Susanna Clarke'))
  })

  it('names the other direction of the taste: the friend has read an author who is on her want-to-read list', () => {
    const [result] = suggestBuddyReads(
      input({
        mine: { want: [book('Kindred', 'Octavia E. Butler')] },
        friend: { want: [], done: [{ book: book('Parable of the Sower', 'Octavia E. Butler') }] },
      }),
    )
    expect(result!.reason).toEqual({ kind: 'author_theirs', author: 'Octavia E. Butler' })
  })

  it('does not take a put-down Book for taste', () => {
    const result = suggestBuddyReads(
      input({
        mine: { finished: [{ book: book('Abandoned', 'Some Author'), abandoned: true }] },
        friend: { want: [book('Another by Some Author', 'Some Author')], done: [] },
      }),
    )
    expect(result).toEqual([])
  })
})

describe('what the friend hides', () => {
  it('contributes nothing: a friend who hides her Want to read gives no Book on both lists, and nothing at all when she hides everything', () => {
    const shared = book('Dune', 'Frank Herbert')
    const mine = { want: [shared] }
    expect(suggestBuddyReads(input({ mine, friend: { want: null, reading: [], done: [] } }))).toEqual([])
    expect(suggestBuddyReads(input({ mine, friend: hidden }))).toEqual([])
    expect(friendShowsAnything(hidden)).toBe(false)
    expect(friendShowsAnything({ ...hidden, reading: [] })).toBe(true)
  })

  it('uses only the lists that are shown: her Reading alone suggests what she wants, and nothing of her Want to read', () => {
    const result = suggestBuddyReads(
      input({
        mine: { want: [book('Dune', 'Frank Herbert'), book('Emma', 'Jane Austen')] },
        friend: { want: null, reading: [book('Emma', 'Jane Austen')], done: null },
      }),
    )
    expect(titles(result)).toEqual(['Emma'])
    expect(reasons(result)).toEqual(['they_reading'])
  })

  it('does not know what a hidden Finished list holds, so it leaves nothing out because of it and takes no taste from it', () => {
    const result = suggestBuddyReads(
      input({ mine: { want: [book('Kindred', 'Octavia E. Butler')] }, friend: { want: [], reading: [], done: null } }),
    )
    expect(result).toEqual([])
  })
})

describe('what is never suggested', () => {
  const dune = () => book('Dune', 'Frank Herbert')

  it('a Book she finished or put down, or the friend finished or put down', () => {
    const a = dune()
    const b = book('Emma', 'Jane Austen')
    const c = book('Ulysses', 'James Joyce')
    const d = book('Hamlet', 'William Shakespeare')
    const result = suggestBuddyReads(
      input({
        mine: { want: [a, b, c, d], finished: [{ book: a }, { book: b, abandoned: true }] },
        friend: { want: [a, b, c, d], done: [{ book: c }, { book: d, abandoned: true }] },
      }),
    )
    expect(result).toEqual([])
  })

  it("a Book of an active buddy read of hers, or one she is invited to, also in another edition", () => {
    const a = dune()
    const b = book('Emma', 'Jane Austen')
    const c = book('Ulysses', 'James Joyce')
    const result = suggestBuddyReads(
      input({
        mine: { want: [a, b, c] },
        friend: { want: [a, b, c], done: [] },
        together: [{ id: a.id, title: a.title, authors: a.authors }, { id: 'another-edition', title: 'EMMA', authors: ['Jane Austen'] }],
      }),
    )
    expect(titles(result)).toEqual(['Ulysses'])
  })

  it('a Manual book on either side, or one the server check could not confirm', () => {
    const manualMine = book('Mine alone', 'Me', { manual: true })
    const manualTheirs = book('Theirs alone', 'Her', { manual: true })
    const unverified = book('', 'Nobody', { unverified: true })
    const result = suggestBuddyReads(
      input({
        mine: { want: [manualMine, manualTheirs, unverified], reading: [] },
        friend: { want: [manualMine, manualTheirs, unverified, book('Other', 'Her', { manual: true })], done: [] },
      }),
    )
    expect(result).toEqual([])
  })
})

describe('the cap', () => {
  it('draws at most twelve, the strongest first and the friend’s order kept within a rank', () => {
    const both = Array.from({ length: 8 }, (_, i) => book(`Both ${i}`, `Author ${i}`))
    const reading = Array.from({ length: 8 }, (_, i) => book(`Mine reading ${i}`, `Writer ${i}`))
    const result = suggestBuddyReads(
      input({
        mine: { want: both, reading },
        friend: { want: [...reading, ...both], done: [] },
      }),
    )
    expect(result).toHaveLength(SUGGESTIONS_MAX)
    expect(SUGGESTIONS_MAX).toBe(12)
    // Both-want comes first although the friend lists the others first; then the ones she is reading, in the friend's order.
    expect(titles(result).slice(0, 8)).toEqual(both.map((b) => b.title))
    expect(reasons(result).slice(0, 8).every((r) => r === 'both_want')).toBe(true)
    expect(titles(result).slice(8)).toEqual(reading.slice(0, 4).map((b) => b.title))
    expect(reasons(result).slice(8).every((r) => r === 'you_reading')).toBe(true)
  })

  it('has nothing to say with nothing in common', () => {
    expect(suggestBuddyReads(input({ mine: { want: [dune()] }, friend: { want: [book('Emma', 'Jane Austen')], done: [] } }))).toEqual([])
  })
})

function dune() {
  return book('Dune', 'Frank Herbert')
}
