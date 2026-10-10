import type { BrowserContextOptions } from '@playwright/test'
import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { goto, openProfile, signedIn, untilStill } from './support'

/**
 * The social loop (social v1, docs/proposals/social-v1-contract.md §6), the one flow of it: two members, each in
 * a browser of her own. Ida (private, as every account starts) copies her follow link; Anna opens it, sees the
 * private card, asks and waits; Ida accepts it from Home; Ida finishes a Book with a rating and a review, and
 * it is a lit card in Anna's Your circle, then a row of the feed, then on Ida's page under Recently finished;
 * Ida hides the Book, and it is gone from the feed and the page; Ida blocks Anna, and the circle is gone and
 * the link no longer opens. Version 2a joins it: Anna likes Ida's finish from the feed (the heart keeps), Ida's
 * Home says "Anna liked your review of …" and its sheet names Anna; Ida marks her review as spoilers, and Anna,
 * who has not finished the Book, sees it folded and unfolds it. The rules behind each step are pgTAP's (supabase/tests/social_*), the data layer's
 * and the views' Vitest; this flow is the screens joined up, the way one member meets another.
 *
 * The settle window (a finish is shown to followers only after it, so a correction is not announced) is
 * zero for the run and back to ten minutes after it, failed or not.
 */

const book: BookSnapshot = {
  title: runTitle('Piranesi'),
  authors: ['Susanna Clarke'],
  isbn13: null,
  isbn10: null,
  pageCount: 272,
  year: 2020,
  language: 'en',
  publisher: TEST_PUBLISHER,
  description: 'A book written for the social flow.',
  coverUrl: null,
  coverThumbhash: null,
  coverColors: null,
  source: 'apple',
  appleId: uniqueAppleId(),
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await sql(`update private.social_config set settle_window = '0'`)
})
test.afterAll(async () => {
  await sql(`update private.social_config set settle_window = '10 minutes'`)
})

test('Ida shares her link, Anna asks and is let in, a finish shows in her circle and goes when it is hidden, a block ends it', async ({
  page: ida,
  browser,
}) => {
  // Two members, a feed and a block: longer than a usual flow.
  test.slow()
  // Anna's browser is Ida's: the project's device, Reduce Motion and blocked service workers.
  const context = await browser.newContext(test.info().project.use as BrowserContextOptions)
  try {
    const anna = await context.newPage()
    const idaMember = await signedIn(ida)
    const annaMember = await signedIn(anna)
    // Their first names, as the sign-up would have kept them (user_metadata.name): what the others read of them.
    for (const [member, name] of [[idaMember, 'Ida'], [annaMember, 'Anna']] as const) {
      await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [member.id, name])
    }

    // Ida's Profile → Friends → Your follow link: private, so "they ask and you decide".
    await openProfile(ida)
    await ida.getByTestId('profile.followLink').click()
    await expect(ida.getByTestId('followLink')).toBeVisible()
    await expect(ida.getByTestId('followLink.value')).toContainText('/f/')
    const link = (await ida.getByTestId('followLink.value').innerText()).trim()
    await ida.getByTestId('followLink.copy').click()
    await expect(ida.getByTestId('followLink.outcome')).toHaveText(en.followLink.copied)
    await ida.keyboard.press('Escape')
    await expect(ida.getByTestId('followLink')).toBeHidden()

    // Anna opens it: the link lands on Ida's page, which is the private card (no books, a lock) and Ask to follow.
    await goto(anna, link)
    await expect(anna).toHaveURL(new RegExp(`/friends/${idaMember.id}$`))
    await expect(anna.getByTestId('member.name')).toHaveText('Ida')
    await expect(anna.getByTestId('member.private')).toBeVisible()
    await expect(anna.getByTestId('member.finished')).toHaveCount(0)
    await anna.getByTestId('member.ask').click()
    await expect(anna.getByTestId('member.requested')).toBeVisible()
    await expect(anna.getByTestId('member.ask')).toBeHidden()

    // Ida's Home shows the request in Your circle; Accept answers it and it leaves.
    await goto(ida, '/')
    await expect(ida.getByTestId('home.title')).toBeVisible()
    const request = ida.getByTestId('home.circleRequest')
    await expect(request).toBeVisible()
    await expect(request).toContainText('Anna')
    await ida.getByTestId('home.circleAccept').click()
    await expect(request).toBeHidden()

    // Ida finishes a Book today, with a rating and a review (the UI's finish is core-loop's; the Library is the API's, as a11y's seed).
    const today = isoDay()
    const added = await createLibrary(idaMember.client).addToLibrary(book, {
      status: 'finished',
      startedOn: addDays(today, -4),
      endedOn: today,
      rating: 18,
      review: 'A house of tides and statues.',
    })
    expect(added.error).toBeNull()

    // Anna's Home: this week's finish is the lit card, with her name, the Book, the stars and the review.
    await goto(anna, '/')
    const card = anna.getByTestId('home.circleFeature')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('home.circleFeature.member')).toContainText('Ida')
    await expect(card.getByTestId('home.circleFeature.title')).toHaveText(book.title)
    await expect(card.getByTestId('home.circleFeature.stars')).toBeVisible()
    await expect(card.getByTestId('home.circleFeature.review')).toHaveText('A house of tides and statues.')

    // Your circle's title opens the feed: the finish is its one entry. Ida's name opens her page, the Book under Recently finished.
    await anna.getByTestId('home.circleTitle').click()
    await expect(anna).toHaveURL(/\/friends\/?$/)
    await expect(anna.getByTestId('friends.entry')).toHaveCount(1)
    await expect(anna.getByTestId('friends.entryBook')).toHaveText(book.title)
    await anna.getByTestId('friends.entryMember').click()
    await expect(anna).toHaveURL(new RegExp(`/friends/${idaMember.id}$`))
    await expect(anna.getByTestId('member.name')).toHaveText('Ida')
    await expect(anna.getByTestId('member.finished').getByTestId('member.finishedTitle')).toHaveText(book.title)

    // Anna likes Ida's finish from the feed: the heart fills at once, counts one and keeps after a reload.
    await goto(anna, '/friends')
    const heart = anna.getByTestId('friends.entryLike')
    await expect(heart).toHaveAttribute('aria-pressed', 'false')
    await heart.click()
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await expect(anna.getByTestId('friends.entryLike.count')).toHaveText('1')
    await goto(anna, '/friends')
    await expect(anna.getByTestId('friends.entryLike')).toHaveAttribute('aria-pressed', 'true')
    await expect(anna.getByTestId('friends.entryLike.count')).toHaveText('1')

    // Ida's Home: one quiet row says who liked her review, and its sheet names Anna.
    await goto(ida, '/')
    const liked = ida.getByTestId('home.like')
    await expect(liked).toHaveCount(1)
    await expect(liked).toContainText(`Anna liked your review of ${book.title}`)
    await liked.click()
    await expect(ida.getByTestId('likers')).toBeVisible()
    await expect(ida.getByTestId('likers.row')).toHaveCount(1)
    await expect(ida.getByTestId('likers.row')).toContainText('Anna')
    await ida.keyboard.press('Escape')
    await expect(ida.getByTestId('likers')).toBeHidden()

    // Ida hides the Book: Library → Finished → the Book → ⋯ → Hide from followers.
    await goto(ida, '/')
    await ida.getByTestId('shell.tab.library').click()
    await ida.getByTestId('library.segment.finished').click()
    await ida.getByTestId('library.entry').click()
    await expect(ida.getByTestId('book.title')).toHaveText(book.title)

    // She marks her review as spoilers (the switch is in the review box, there with the text): Anna has not
    // finished the Book, so her feed folds the review behind Show anyway, and Show anyway unfolds it.
    await ida.getByTestId('history.edit').first().click()
    await expect(ida.getByTestId('editSession')).toBeVisible()
    await ida.getByTestId('editSession.spoilers').click()
    await expect(ida.getByTestId('editSession.spoilers')).toHaveAttribute('aria-checked', 'true')
    await ida.getByTestId('editSession.submit').click()
    await expect(ida.getByTestId('editSession')).toBeHidden()
    await goto(anna, '/friends')
    await expect(anna.getByTestId('friends.entryFolded')).toContainText(en.review.folded)
    await expect(anna.getByTestId('friends.entryReview')).toHaveCount(0)
    await expect(anna.getByTestId('friends.entryLike')).toBeVisible()
    await anna.getByTestId('review.showAnyway').click()
    await expect(anna.getByTestId('friends.entryReview')).toHaveText('A house of tides and statues.')
    await expect(anna.getByTestId('friends.entryFolded')).toHaveCount(0)

    await ida.getByTestId('book.options').click()
    await expect(ida.getByTestId('bookOptions')).toBeVisible()
    const hide = ida.getByTestId('bookOptions.hide')
    await expect(hide).toHaveAttribute('aria-checked', 'false')
    await hide.click()
    await expect(hide).toHaveAttribute('aria-checked', 'true')
    await ida.keyboard.press('Escape')
    await expect(ida.getByTestId('bookOptions')).toBeHidden()

    // Gone from Anna's feed, her Home and Ida's page.
    await goto(anna, '/friends')
    await expect(anna.getByTestId('friends')).toBeVisible()
    await expect(anna.getByTestId('friends.entry')).toHaveCount(0)
    await goto(anna, `/friends/${idaMember.id}`)
    await expect(anna.getByTestId('member.name')).toHaveText('Ida')
    await untilStill(anna)
    await expect(anna.getByTestId('member.finishedTitle')).toHaveCount(0)
    await goto(anna, '/')
    await expect(anna.getByTestId('home.title')).toBeVisible()
    await expect(anna.getByTestId('home.circleFeature')).toHaveCount(0)

    // Ida blocks Anna: Profile → People → Followers → ⋯ → Block → confirm.
    await goto(ida, '/')
    await openProfile(ida)
    await ida.getByTestId('profile.people').click()
    await expect(ida.getByTestId('people')).toBeVisible()
    await ida.getByTestId('people.segment.followers').click()
    await expect(ida.getByTestId('people.row')).toHaveCount(1)
    await ida.getByTestId('people.rowMore').click()
    await expect(ida.getByTestId('memberSheet')).toBeVisible()
    await ida.getByTestId('memberSheet.block').click()
    await expect(ida.getByTestId('blockConfirm')).toBeVisible()
    await ida.getByTestId('blockConfirm.confirm').click()
    await expect(ida.getByTestId('blockConfirm')).toBeHidden()
    await expect(ida.getByTestId('people.row')).toHaveCount(0)

    // Anna's Your circle is gone, and the link answers "This link isn't here any more".
    await goto(anna, '/')
    await expect(anna.getByTestId('home.title')).toBeVisible()
    await expect(anna.getByTestId('home.circle')).toHaveCount(0)
    await goto(anna, link)
    await expect(anna.getByTestId('follow.missing')).toContainText(en.follow.missingTitle)
  } finally {
    await context.close()
  }
})
