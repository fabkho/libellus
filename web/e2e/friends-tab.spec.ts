import { expect, test } from './fixtures'
import en from '../i18n/locales/en.json' with { type: 'json' }
import { goto, openProfile, signedIn, untilStill } from './support'

/**
 * The Friends tab: in the tab bar by default for every member, even one who follows nobody, after Library;
 * it opens the feed as a tab page (the tab layout's header, its People button beside the avatar, no Back);
 * Profile → Account → Friends tab turns it off at once, and `/friends` is then the pushed screen it was
 * (its own top bar and Back), also on a reload or a deep link. The switch is a setting of this device,
 * under `libellus.` (utils/friendsTab.ts). The rule is Vitest's (tests/friends-tab.test.ts); this is the
 * screens joined up.
 */

const KEY = 'libellus.friendsTab'

test('the Friends tab is in the bar by default, opens the feed (empty for a member who follows nobody), People and back', async ({ page }) => {
  await signedIn(page)
  const bar = page.getByTestId('shell.tabs')
  const tab = page.getByTestId('shell.tab.friends')

  // Home, Library, Friends, then Search.
  await expect(tab).toHaveText(en.tabs.friends)
  const order = await bar.locator('[data-testid^="shell.tab."]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  expect(order).toEqual(['shell.tab.home', 'shell.tab.library', 'shell.tab.friends', 'shell.tab.search'])
  await expect(tab).not.toHaveAttribute('aria-current', 'page')

  await tab.click()
  await expect(page).toHaveURL(/\/friends\/?$/)
  await expect(tab).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('shell.tab.home')).not.toHaveAttribute('aria-current', 'page')
  // A tab page: the tab layout's header (title, avatar) and no Back; the empty state of a member who follows nobody.
  await expect(page.getByTestId('shell.header')).toBeVisible()
  await expect(page.getByTestId('friends.title')).toHaveText(en.friends.title)
  await expect(page.getByTestId('friends.back')).toHaveCount(0)
  await expect(page.getByTestId('friends.empty')).toBeVisible()
  await expect(page.getByTestId('friends.emptyShare')).toBeVisible()
  await expect(page.getByTestId('shell.tabs')).toBeVisible()

  // People opens the pushed screen; Back is the tab again, lit, with its feed.
  await page.getByTestId('friends.people').click()
  await expect(page).toHaveURL(/\/friends\/people\/?$/)
  await expect(page.getByTestId('shell.tab.friends')).not.toHaveAttribute('aria-current', 'page')
  await page.goBack()
  await expect(page).toHaveURL(/\/friends\/?$/)
  await expect(tab).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('friends.empty')).toBeVisible()

  // The other tabs are as they were.
  await page.getByTestId('shell.tab.library').click()
  await expect(page).toHaveURL(/\/library\/?$/)
  await page.getByTestId('shell.tab.home').click()
  await expect(page.getByTestId('home.title')).toBeVisible()
})

test('Profile → Friends tab turns the tab off at once and on again; the feed is the pushed screen while it is off', async ({ page }) => {
  await signedIn(page)
  await openProfile(page)
  const row = page.getByTestId('profile.friendsTab')
  await row.scrollIntoViewIfNeeded()
  await expect(row).toHaveText(en.profile.account.friendsTab)
  await expect(row).toHaveAttribute('aria-checked', 'true')
  // The Profile's Friends row opens the feed: the tab, with the tab on.
  await expect(page.getByTestId('shell.tab.friends')).toBeVisible()

  await row.click()
  await expect(row).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('shell.tab.friends')).toHaveCount(0)
  await expect(page.getByTestId('shell.tab.home')).toBeVisible()
  await expect(page.getByTestId('shell.tab.library')).toBeVisible()
  await expect(page.getByTestId('shell.tab.search')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe('off')

  // Off: Profile → Friends is the pushed screen, with its own top bar and Back to the Profile.
  const friendsRow = page.getByTestId('profile.friendsRow')
  await friendsRow.scrollIntoViewIfNeeded()
  await friendsRow.click()
  await expect(page).toHaveURL(/\/friends\/?$/)
  await expect(page.getByTestId('friends.back')).toBeVisible()
  await expect(page.getByTestId('friends.title')).toHaveText(en.feed.title)
  await expect(page.getByTestId('shell.header')).toHaveCount(0)
  await expect(page.getByTestId('friends.empty')).toBeVisible()
  await page.getByTestId('friends.people').click()
  await expect(page).toHaveURL(/\/friends\/people\/?$/)
  await page.goBack()
  await page.getByTestId('friends.back').click()
  await expect(page).toHaveURL(/\/profile\/?$/)

  // It stays off after a reload, and a deep link on /friends shows the pushed screen, no crash.
  await goto(page, '/profile')
  await expect(page.getByTestId('profile.friendsTab')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('shell.tab.friends')).toHaveCount(0)
  await goto(page, '/friends')
  await expect(page.getByTestId('friends.back')).toBeVisible()
  await expect(page.getByTestId('shell.tab.friends')).toHaveCount(0)
  await expect(page.getByTestId('friends.empty')).toBeVisible()

  // On again: the tab is back, and /friends is a tab page.
  await goto(page, '/profile')
  await page.getByTestId('profile.friendsTab').scrollIntoViewIfNeeded()
  await page.getByTestId('profile.friendsTab').click()
  await expect(page.getByTestId('shell.tab.friends')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBeNull()
  await page.getByTestId('shell.tab.friends').click()
  await expect(page.getByTestId('friends.back')).toHaveCount(0)
  await expect(page.getByTestId('shell.header')).toBeVisible()
})

test('a deep link or reload on /friends with the tab off shows the pushed screen', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'off'), KEY)
  await signedIn(page)
  await expect(page.getByTestId('shell.tab.friends')).toHaveCount(0)
  await goto(page, '/friends')
  await expect(page.getByTestId('friends')).toBeVisible()
  await expect(page.getByTestId('friends.back')).toBeVisible()
  await expect(page.getByTestId('friends.title')).toHaveText(en.feed.title)
  await expect(page.getByTestId('shell.tab.friends')).toHaveCount(0)
  // Back with nothing before it in the app is Home.
  await page.getByTestId('friends.back').click()
  await expect(page.getByTestId('home.title')).toBeVisible()
})

test('a deep link on /friends with the tab on shows the tab, lit', async ({ page }) => {
  await signedIn(page)
  await goto(page, '/friends')
  await expect(page.getByTestId('shell.tab.friends')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('friends.back')).toHaveCount(0)
  await expect(page.getByTestId('friends.title')).toHaveText(en.friends.title)
  // The feed's answer is in before the page goes (a request cut off is an uncaught error to the fixture).
  await expect(page.getByTestId('friends.empty')).toBeVisible()
})

for (const width of [360, 390]) {
  test(`the four places of the bar sit inside a ${width} px screen, centred, nothing clipped`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await signedIn(page)
    await untilStill(page)
    const box = await page.getByTestId('shell.tabs').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    // Centred on the screen (the capsule is `left: 50%`).
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(1.5)
    for (const key of ['home', 'library', 'friends', 'search']) {
      const tab = await page.getByTestId(`shell.tab.${key}`).boundingBox()
      expect(tab!.width).toBeGreaterThan(40)
      expect(tab!.x).toBeGreaterThanOrEqual(box!.x - 0.5)
      expect(tab!.x + tab!.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5)
    }
  })
}

test('the search palette lists the same tabs: Friends too, and only with the tab on', async ({ page }) => {
  await signedIn(page)
  await page.getByTestId('shell.tab.search').click()
  await expect(page.getByTestId('search.query')).toBeVisible()
  // With the keyboard down the row shows the tabs (Cancel replaces them while typing).
  await page.getByTestId('search.query').evaluate((input) => (input as HTMLInputElement).blur())
  await expect(page.getByTestId('search.tab.friends')).toBeVisible()
  await page.getByTestId('search.tab.friends').click()
  await expect(page).toHaveURL(/\/friends\/?$/)
  await expect(page.getByTestId('shell.tab.friends')).toHaveAttribute('aria-current', 'page')
})
