import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import de from '../i18n/locales/de.json' with { type: 'json' }
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { signUpMember } from '../tests/support/member'
import { recordedApple, signedIn, untilStill } from './support'

/**
 * Home's reading card says how far as a percent and no longer since when; the Friends tab's empty state
 * fits the screen, is decided before it is drawn, and never shows for a member who has friends.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

function book(title: string, pageCount: number | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Polish${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

type Member = Awaited<ReturnType<typeof signedIn>>

/** A read that has begun, with `page` recorded (null: nothing recorded). */
async function reading(member: Member, title: string, pageCount: number | null, page: number | null) {
  const entry = (await createLibrary(member.client).addToLibrary(book(title, pageCount), { status: 'reading', startedOn: isoDay() })).data!
  if (page !== null) await sql('update public.reading_sessions set progress_page = $2, progress_updated_at = now() where entry_id = $1 and outcome is null', [entry.id, page])
  return entry
}

const card = (page: Page, title: string) => page.getByTestId('home.readingCard').filter({ hasText: runTitle(title) })

test('Home: the card says the percent, never a page as a percent, and has no "since" line', async ({ page }) => {
  const member = await signedIn(page)
  await reading(member, 'Percent', 300, 126)
  await reading(member, 'Start', 300, 0)
  await reading(member, 'End', 300, 300)
  await reading(member, 'Nocount', null, 40)
  await page.reload()
  await expect(page.getByTestId('home.readingCard')).toHaveCount(4)

  const percent = card(page, 'Percent')
  await expect(percent.getByTestId('home.entryPercent')).toHaveText('42 %')
  await expect(percent.getByTestId('home.progressValue')).toHaveText('p. 126 of 300')
  await expect(percent.getByTestId('home.progressBar')).toHaveAttribute('aria-valuetext', '42 % · p. 126 of 300')
  await expect(card(page, 'Start').getByTestId('home.entryPercent')).toHaveText('0 %')
  await expect(card(page, 'End').getByTestId('home.entryPercent')).toHaveText('100 %')
  // No page count: a page says nothing about how far, so no percent.
  await expect(card(page, 'Nocount').getByTestId('home.entryPercent')).toHaveCount(0)
  await expect(card(page, 'Nocount').getByTestId('home.progressValue')).toHaveText('p. 40')

  await expect(page.getByTestId('home.entrySince')).toHaveCount(0)
  for (const text of await page.getByTestId('home.readingCard').allInnerTexts()) expect(text).not.toMatch(/since|seit/i)
})

test.describe('German', () => {
  test.use({ locale: 'de-DE' })

  test('Home: the same card in German says "42 %" and no "seit"', async ({ page }) => {
    const member = await signedIn(page)
    await reading(member, 'Prozent', 300, 126)
    await page.reload()
    const prozent = card(page, 'Prozent')
    await expect(prozent.getByTestId('home.entryPercent')).toHaveText(de.book.progress.percent.replace('{percent}', '42'))
    await expect(prozent.getByTestId('home.entryPercent')).toHaveText('42 %')
    await expect(page.getByTestId('home.entrySince')).toHaveCount(0)
    expect(await page.getByTestId('home.readingCard').innerText()).not.toMatch(/seit|since/i)
  })
})

for (const [width, height] of [
  [360, 640],
  [390, 844],
] as const) {
  test(`Friends: the empty state fits ${width}x${height} without scrolling (and with an installed app's insets when tall enough)`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await signedIn(page)
    await page.getByTestId('shell.tab.friends').click()
    await expect(page.getByTestId('friends.empty')).toBeVisible()
    await expect(page.getByTestId('friends.lamp')).toBeVisible()
    await untilStill(page)
    const overflow = () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    expect(await overflow()).toBeLessThanOrEqual(0)
    // An installed iPhone app: the safe areas are the status bar's and the home indicator's (the browser reports 0).
    // (Only on a phone tall enough to have them: no installed iPhone is 640 high.)
    if (height >= 800) {
      await page.addStyleTag({ content: ':root { --safe-area-top: 47px; --safe-area-bottom: 34px; }' })
      await untilStill(page)
      expect(await overflow()).toBeLessThanOrEqual(0)
    }
    await expect(page.getByTestId('friends.emptyShare')).toBeInViewport()
  })
}

test('Friends: a member who has friends never sees the empty state while the answer is on its way', async ({ page }) => {
  const anna = await signedIn(page)
  const ida = await signUpMember()
  await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', 'Ida') where id = $1`, [ida.id])
  await sql(`insert into public.follows (follower_id, followee_id, accepted_at) values ($1, $2, now())`, [anna.id, ida.id])
  await createLibrary(ida.client).addToLibrary(book('Idas', 200), { status: 'reading', startedOn: isoDay() })
  // Settled: what Ida did is on the feed at once, not after the ten minutes.
  await sql(`update public.activity set visible_at = now() - interval '1 minute' where member_id = $1`, [ida.id])

  // The answers come two seconds late (a cold start, a slow network).
  await page.route('**/rest/v1/rpc/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await route.continue()
  })
  // Watched from the first frame on: the empty state is never in the document.
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __seen: string[] }).__seen = seen
    new MutationObserver(() => {
      for (const id of ['friends.empty', 'friends.quiet']) if (document.querySelector(`[data-testid="${id}"]`)) seen.push(id)
    }).observe(document, { childList: true, subtree: true })
  })
  // A cold start: nothing of the feed on the device yet.
  await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('libellus.feed')).forEach((key) => localStorage.removeItem(key)))
  await page.goto('/friends')
  await expect(page.getByTestId('friends.loading')).toBeVisible()
  await expect(page.getByTestId('friends.empty')).toHaveCount(0)
  await expect(page.getByTestId('friends.entry').first()).toBeVisible({ timeout: 15_000 })
  expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual([])

  // Opened again, the copy of the device is there at once: no skeleton, no empty state.
  await page.goto('/friends')
  await expect(page.getByTestId('friends.entry').first()).toBeVisible()
  await expect(page.getByTestId('friends.loading')).toHaveCount(0)
  await expect(page.getByTestId('friends.empty')).toHaveCount(0)
})

test('Friends: a member who follows nobody gets the right empty state at once on the second visit', async ({ page }) => {
  await signedIn(page)
  await page.getByTestId('shell.tab.friends').click()
  await expect(page.getByTestId('friends.empty')).toBeVisible()
  // A new visit with the answer remembered: neither the skeleton nor the other empty state in between.
  await page.reload()
  await page.getByTestId('shell.tab.friends').click()
  await expect(page.getByTestId('friends.empty')).toBeVisible()
  await expect(page.getByTestId('friends.quiet')).toHaveCount(0)
})
