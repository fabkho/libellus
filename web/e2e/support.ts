import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page } from '@playwright/test'
import { ratingX } from '../app/utils/rating'
import { appleAnswer, appleCover } from '../tests/support/apple'
import { openLibraryAnswer } from '../tests/support/openLibrary'
import { INSTALL_HINT_KEY } from '../app/utils/installHint'
import { IMPORT_HINT_KEY } from '../app/utils/importHint'
import { createAuth } from '../app/data/auth'
import { signUpMember } from '../tests/support/member'
import { emailCooldown, newClient, readMailedCode, serviceRoleKey, stack } from '../tests/support/stack'

/**
 * Answers every source behind search from the recordings: Apple
 * (tests/fixtures/apple) and OpenLibrary (tests/fixtures/openlibrary), their
 * search APIs and their covers. No flow ever reaches a live API. Covers are
 * the recorded stand-in, served with the CDNs' CORS header, so the app can
 * read them to make the thumbhash.
 */
export async function recordedApple(page: Page) {
  await page.route('https://itunes.apple.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(appleAnswer(new URL(route.request().url()))),
    }),
  )
  await page.route('https://openlibrary.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(openLibraryAnswer(new URL(route.request().url()))),
    }),
  )
  await page.route('https://covers.openlibrary.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: appleCover(),
    }),
  )
  await page.route(/^https:\/\/is\d-ssl\.mzstatic\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: appleCover(),
    }),
  )
}

/**
 * After `recordedApple`: the recordings answer a search for "piranesi" only, and the
 * import and its Choose edition sheet ask for "<title> <first author>"
 * ("Piranesi Susanna Clarke"). This points that query at the same recordings, so
 * a book without an ISBN finds Piranesi's many editions by its title.
 */
export async function recordedTitleQuery(page: Page) {
  const recorded = (url: URL) => {
    for (const [name, value] of url.searchParams) if (value.trim().toLowerCase() === 'piranesi susanna clarke') url.searchParams.set(name, 'piranesi')
    return url
  }
  for (const [host, answer] of [
    ['https://itunes.apple.com/**', appleAnswer],
    ['https://openlibrary.org/**', openLibraryAnswer],
  ] as const)
    await page.route(host, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(answer(recorded(new URL(route.request().url())))),
      }),
    )
}

/** What supabase-js keeps of a session (`sb-<host>-auth-token`), kept in memory on the test's side. */
export function sessionStorageInMemory() {
  const kept = new Map<string, string>()
  return {
    kept,
    storage: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  }
}

/**
 * Hands a session made through the API (`signUpMember`, `signedInClient`) to the page: the
 * entries supabase-js wrote are put into its localStorage before the app boots, so the app
 * starts signed in, the way it does for a member who signed in before. Once per tab (a flag in
 * sessionStorage): a sign-out in the flow sticks, and a second call for someone else (the next
 * member on the same page) puts theirs in on the next load.
 */
export async function handSession(page: Page, kept: Map<string, string>) {
  await page.addInitScript(
    ([flag, entries]) => {
      if (sessionStorage.getItem(flag)) return
      sessionStorage.setItem(flag, '1')
      for (const [key, value] of entries) localStorage.setItem(key, value)
    },
    [`libellus-e2e:session-${randomUUID()}`, [...kept]] as const,
  )
}

/**
 * A fresh member, signed in. The sign-in itself is e2e/auth.spec.ts's (and a11y's, and
 * core-loop's, with `throughTheScreens`): here the member signs up through the API (an invite, a
 * mailed code, the code typed back) and the page is handed that session (`handSession`), so a
 * flow starts on Home without the sign-in screens, a second mail and a wait for the mail's cooldown. The test's client keeps the same session for
 * the setup it does through the API; it never refreshes it in a flow's minute (the token lives
 * an hour), so the page's refresh token stays the one in use.
 *
 * Every flow runs on an iPhone's Safari, where Home shows the install hint
 * (issue #94) above what the flow reads and taps. It is dismissed from the
 * start, the way a member who has been here before has: `installHint: true`
 * leaves it to the flow that is about it (e2e/install-hint.spec.ts).
 *
 * The same goes for Home's offer of the import (a card on the empty Home and over a Library of
 * a few Books, utils/importHint.ts): the member is marked as one who imported before, so no flow
 * has it above what it reads and taps. `importHint: true` leaves it to the flow that is
 * about it (e2e/import-offer.spec.ts).
 */
export async function signedIn(
  page: Page,
  {
    installHint = false,
    importHint = false,
    throughTheScreens = false,
  }: { installHint?: boolean; importHint?: boolean; throughTheScreens?: boolean } = {},
) {
  if (!installHint) {
    await page.addInitScript((key) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, String(Date.now()))
    }, INSTALL_HINT_KEY)
  }
  const { kept, storage } = sessionStorageInMemory()
  const member = await signUpMember(storage)
  if (!throughTheScreens) await handSession(page, kept)
  if (!importHint) {
    await page.addInitScript(
      ([key, id]) => localStorage.setItem(key!, JSON.stringify({ ...JSON.parse(localStorage.getItem(key!) ?? '{}'), [id!]: 'imported' })),
      [IMPORT_HINT_KEY, member.id],
    )
  }
  if (throughTheScreens) {
    await emailCooldown()
    await page.goto('/sign-in')
    await page.getByTestId('signIn.email').fill(member.email)
    await page.getByTestId('signIn.submit').click()
    await expect(page).toHaveURL(/\/verify$/)
    await page.getByTestId('verify.code').fill(await readMailedCode(member.email, 2))
  } else {
    await page.goto('/')
  }
  await expect(page.getByTestId('home.title')).toBeVisible()
  return member
}

/**
 * Someone who exists signs in once more, on a client of its own (another device): the auth
 * server's admin makes the code (no mail, so no mail's cooldown and no other flow's code read by
 * mistake) and it is typed back the way the app does. Its session can be handed to a page
 * (`handSession`, or `signedInAs`).
 */
export async function signedInClient(email: string) {
  const key = serviceRoleKey()
  const response = await fetch(`${stack.url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  const link = (await response.json()) as { email_otp?: string; properties?: { email_otp?: string }; msg?: string }
  const code = link.email_otp ?? link.properties?.email_otp
  if (!response.ok || !code) throw new Error(`No sign-in code for ${email}: ${response.status} ${JSON.stringify(link)}`)
  const { kept, storage } = sessionStorageInMemory()
  const client = newClient(storage)
  const verified = await createAuth(client).verifyCode(email, code)
  if (verified.error) throw new Error(`Sign-in of ${email} failed: ${verified.error}`)
  return { client, kept }
}

/** Someone who exists (the shelf's owner, a member on another device), signed in on this page, on Home. */
export async function signedInAs(page: Page, email: string) {
  const { client, kept } = await signedInClient(email)
  await handSession(page, kept)
  await page.goto('/')
  await expect(page.getByTestId('home.title')).toBeVisible()
  return client
}

/**
 * Waits until nothing on the page is moving: no sheet rising or sliding away,
 * no list opening or closing an item's room (both carry `data-moving` until
 * their transition has ended), and no page still on its way to its scroll
 * place after a navigation (the document carries it until the router has
 * scrolled, app/router.options.ts). Watching an element's box instead is not
 * enough: a slow runner may paint no frame between two looks, and a sheet
 * mid-rise then seems to stand still.
 */
export async function untilStill(page: Page) {
  await expect(page.locator('[data-moving]')).toHaveCount(0)
}

/**
 * Opens the Profile from the avatar and waits until it has come to rest, the
 * way a member waits to read it before she reaches for a row. The page stands
 * in its final shape from the first frame (a member with nothing finished has
 * the empty state over her account rows at once, the Library being on the
 * device), so the rows no longer slide when the reading record lands
 * (e2e/profile.spec.ts watches them). Still: the record in (`profile.library`
 * is the hero's line for it), then nothing moving, so a flow reads the page as
 * a member does and a Library the device did not have yet has been settled too.
 */
export async function openProfile(page: Page) {
  await page.getByTestId('shell.avatar').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('profile.library')).toBeVisible()
  await untilStill(page)
}

/**
 * Brings the tab bar back the way a member does: up to the top of the page,
 * where it always shows (composables/useHideOnScroll.ts). A page scrolled down
 * to a control has it away, and a tap on a tab that is off the screen goes
 * nowhere ("element is outside of the viewport").
 */
export async function showTabBar(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page.getByTestId('shell.tabs')).not.toHaveAttribute('data-away')
}

/**
 * Opens an address the way a member types it in, once the page she is on has
 * come to rest: nothing moving (`untilStill`) and no sheet's own history entry
 * left on top of the page's (composables/useBackDismiss.ts). A sheet that has
 * just closed steps back off its entry a moment later, and WebKit loses a page
 * load that starts during that step back: `load` never comes, or its driver
 * reports an internal error (collections.spec.ts in CI).
 */
export async function goto(page: Page, url: string) {
  await untilStill(page)
  const layers = () => page.evaluate(() => (history.state as { libellusLayer?: number } | null)?.libellusLayer ?? 0)
  await expect.poll(layers).toBe(0)
  await page.goto(url)
}

/**
 * Where an element is once the sheet it is in has finished rising: it is on
 * the page, nothing is moving (`untilStill`) and its box held still between
 * two looks (a sheet that opens a moment after the tap has to have started
 * rising first).
 */
export async function settledBox(locator: Locator) {
  const moving = locator.page().locator('[data-moving]')
  let last = null as Awaited<ReturnType<Locator['boundingBox']>>
  await expect
    .poll(
      async () => {
        // Nothing moving first, then the box: a box read after that is in place.
        const calm = (await moving.count()) === 0
        const box = await locator.boundingBox()
        const still = calm && Boolean(box && last && box.y === last.y)
        last = box
        return still
      },
      { intervals: [100] },
    )
    .toBe(true)
  return last!
}

/** A finger (here a mouse) pressed on the stars and dragged to `quarters`. */
export async function dragRating(page: Page, control: Locator, quarters: number) {
  const box = await settledBox(control)
  const y = box.y + box.height / 4
  const [size, gap] = [44, 12]
  await page.mouse.move(box.x + size / 2, y)
  await page.mouse.down()
  for (const q of [4, 8, 12, quarters]) await page.mouse.move(box.x + ratingX(q, size, gap) + 1, y, { steps: 4 })
  await page.mouse.up()
}

/**
 * The page never moves sideways (docs/DESIGN.md, The page does not scroll sideways): the
 * document is no wider than the viewport, and no element of the page itself sticks out of it.
 *
 * `html` and `body` clip the x axis (main.css), so the page cannot be wider whatever is
 * inside it, and `scrollWidth` alone would stay quiet about an element that is cut off. The
 * second look finds those: every element whose box leaves the viewport, except where the
 * box is meant to: inside something that scrolls or clips (the year cards, Regal's row) and
 * what is fixed to the screen (a sheet's own frame, Regal's out-of-the-row view).
 */
export async function expectNoSideScroll(page: Page, where: string) {
  const found = await page.evaluate(() => {
    const root = document.documentElement
    const width = root.clientWidth
    const clipsAt = (el: Element) => {
      if (getComputedStyle(el).position === 'fixed') return true
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowX !== 'visible') return true
      }
      return false
    }
    const outside: string[] = []
    const name = (el: Element) => {
      const id = el.getAttribute('data-testid')
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}`
    }
    for (const el of document.body.querySelectorAll('*')) {
      const box = el.getBoundingClientRect()
      if (!box.width && !box.height) continue
      if (box.right <= width + 0.5 && box.left >= -0.5) continue
      // Visually hidden for assistive tech (`sr-only`, Nuxt's route announcer): a clipped 1 px box.
      if (box.width <= 1 && box.height <= 1 && getComputedStyle(el).overflow === 'hidden') continue
      if (clipsAt(el)) continue
      outside.push(`${name(el)} ${Math.round(box.left)}…${Math.round(box.right)}`)
    }
    // A word wider than its box runs out of it without widening the box: look at the text itself.
    const words = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = words.nextNode(); node; node = words.nextNode()) {
      const parent = node.parentElement
      if (!parent || !node.textContent?.trim() || getComputedStyle(parent).overflowX !== 'visible' || clipsAt(parent) || parent.closest('[aria-hidden="true"]')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const box of range.getClientRects()) {
        if (box.right <= width + 0.5 && box.left >= -0.5) continue
        outside.push(`text in ${name(parent)} ${Math.round(box.left)}…${Math.round(box.right)}`)
        break
      }
    }
    return { scrollWidth: root.scrollWidth, clientWidth: width, scrollX: window.scrollX, outside }
  })
  expect.soft(found.scrollWidth, `${where}: the document is wider than the viewport`).toBeLessThanOrEqual(found.clientWidth)
  expect.soft(found.scrollX, `${where}: the page was moved sideways`).toBe(0)
  expect.soft(found.outside, `${where}: elements stick out of the viewport`).toEqual([])
}

// ------------------------------------------------------------- accessibility

/** The WCAG 2.2 A and AA rules and axe's best practices. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa', 'best-practice']

/** Known violations: the rule, where (text the node's selector or its HTML contains), and why it is allowed. */
export const ALLOWED: { rule: string; where: string; reason: string }[] = [
]

const allowed = (rule: string, node: { target: string; html: string }) =>
  ALLOWED.some((a) => a.rule === rule && (node.target.includes(a.where) || node.html.includes(a.where)))

/** Scans the page as it is now (once nothing moves) and fails on a serious or critical violation. */
export async function expectAccessible(page: Page, where: string) {
  await untilStill(page)
  // Lists fade in over `standard` after they have their room; axe reads colours as drawn. Endless
  // animations (a caret, the loading shimmer) never finish and are not waited for.
  // Until none is left, not only the first lot: under Reduce Motion a transition that declares its
  // properties takes 1 ms, and a switched theme's colours go down through Regal's panels a level a frame.
  await page.evaluate(async () => {
    const running = () => document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity)
    for (let round = 0; round < 100 && running().length; round++) {
      await Promise.all(running().map((a) => a.finished.catch(() => {})))
      await new Promise(requestAnimationFrame)
    }
  })
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const found = violations.flatMap((v) =>
    v.nodes
      .filter((node) => !allowed(v.id, { target: node.target.join(' '), html: node.html }))
      .map((node) => ({ rule: v.id, impact: v.impact ?? 'minor', target: node.target.join(' '), summary: node.failureSummary ?? '' })),
  )
  const blocking = found.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const other = found.filter((v) => !blocking.includes(v))
  if (other.length) console.log(`[a11y] ${where}: ${other.map((v) => `${v.impact} ${v.rule} ${v.target}`).join('; ')}`)
  // Soft: one scan's findings do not hide the next screen's.
  expect.soft(
    blocking.map((v) => `${v.impact} ${v.rule} at ${v.target}: ${v.summary.split('\n').slice(0, 2).join(' ')}`),
    `serious or critical accessibility violations on ${where}`,
  ).toEqual([])
}
