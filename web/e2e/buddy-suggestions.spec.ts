import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { runTitle } from '../tests/support/stack'
import { catalogueBook, friendOf, friendShows, onPile } from './buddySuggestions'
import { friendPath } from './bothRead'
import { signedIn } from './support'

/**
 * Potential buddy reads on a friend's profile (docs/parity.md): two members who follow each other with overlapping Want to read lists. The section
 * is her phone's own work from what she may already see (utils/buddySuggestions.ts: the ranking and the exclusions are Vitest's, tests/buddy-suggestions.test.ts);
 * what is guarded here is the screen joined up: the right covers, in the right order, named by title and reason, a link to the Book's page; and
 * that a friend who hides her Want to read leaves nothing, not even a question asked.
 */

test.describe('Potential buddy reads', () => {
  test('a friend with an overlapping Want to read: the shared Books are covers that link to their pages, the others are not there', async ({ page }) => {
    const viewer = await signedIn(page)
    const friend = await friendOf(viewer)
    const first = await catalogueBook('Piranesi', 'Susanna Clarke')
    const second = await catalogueBook('Circe', 'Madeline Miller')
    const hers = await catalogueBook('Only hers', 'Nobody A')
    const mine = await catalogueBook('Only mine', 'Nobody B')
    const finished = await catalogueBook('Already read', 'Nobody C')
    // The friend's list, newest first: Circe, Piranesi, Only hers, Already read. Anna wants Piranesi, Circe, Only mine, and has read Already read.
    await onPile(friend, finished, 'want', 40)
    await onPile(friend, hers, 'want', 30)
    await onPile(friend, first, 'want', 20)
    await onPile(friend, second, 'want', 10)
    await onPile(viewer, first, 'want', 5)
    await onPile(viewer, second, 'want', 4)
    await onPile(viewer, mine, 'want', 3)
    await onPile(viewer, finished, 'finished', 2)

    await page.goto(friendPath(friend))
    const section = page.getByTestId('member.buddy')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading', { name: en.member.buddy.title })).toBeVisible()
    const books = section.getByTestId('member.buddy.book')
    await expect(books).toHaveCount(2)
    // Both want it: in the friend's order (newest first), each named by its title and why.
    const reason = en.member.buddy.bothWant
    await expect(books.nth(0)).toHaveAttribute('aria-label', `${runTitle('Circe')}. ${reason}`)
    await expect(books.nth(1)).toHaveAttribute('aria-label', `${runTitle('Piranesi')}. ${reason}`)
    await expect(books.nth(0)).toHaveAttribute('href', `/book/${second}`)
    await expect(books.nth(1)).toHaveAttribute('href', `/book/${first}`)
    // It is a list of links, and none of the Books that are only on one list, or that one of them has read, is in it.
    await expect(section.getByRole('list').getByRole('listitem')).toHaveCount(2)
    for (const title of ['Only hers', 'Only mine', 'Already read']) await expect(section.getByRole('link', { name: runTitle(title) })).toHaveCount(0)

    // A tap lands on the Book's page.
    await books.nth(1).click()
    await expect(page).toHaveURL(new RegExp(`/book/${first}$`))
    await expect(page.getByTestId('book.title')).toHaveText(runTitle('Piranesi'))
  })

  test('a friend who hides her Want to read leaves no section; one who hides all she shows leaves nothing asked either', async ({ page }) => {
    const viewer = await signedIn(page)
    const friend = await friendOf(viewer)
    const shared = await catalogueBook('Hidden pile', 'Somebody')
    await onPile(friend, shared, 'want')
    await onPile(viewer, shared, 'want')
    await friendShows(friend, { want: false })

    const asked: string[] = []
    page.on('request', (request) => {
      if (/\/rpc\/my_buddy_reads/.test(request.url())) asked.push(request.url())
    })
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.hero')).toBeVisible()
    // Her Want to read is hidden (so is its block): the Book both want is not hers to show, so it is not suggested.
    await expect(page.getByTestId('member.want')).toHaveCount(0)
    await page.waitForTimeout(800)
    await expect(page.getByTestId('member.buddy')).toHaveCount(0)

    // Nothing of her reading is shown at all: nothing to compare, so nothing is asked of buddy reads.
    await friendShows(friend, { want: false, reading: false, finished: false })
    asked.length = 0
    await page.reload()
    await expect(page.getByTestId('member.hero')).toBeVisible()
    await page.waitForTimeout(800)
    await expect(page.getByTestId('member.buddy')).toHaveCount(0)
    expect(asked, 'my_buddy_reads is not asked while the profile hides what the section needs').toHaveLength(0)
  })

  test('with nothing in common there is no section, and no empty state', async ({ page }) => {
    const viewer = await signedIn(page)
    const friend = await friendOf(viewer)
    await onPile(friend, await catalogueBook('Hers alone', 'Writer One'), 'want')
    await onPile(viewer, await catalogueBook('Mine alone', 'Writer Two'), 'want')
    await page.goto(friendPath(friend))
    await expect(page.getByTestId('member.want')).toBeVisible()
    await page.waitForTimeout(800)
    await expect(page.getByTestId('member.buddy')).toHaveCount(0)
  })
})
