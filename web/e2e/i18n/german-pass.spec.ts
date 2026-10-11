import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import de from '../../i18n/locales/de.json' with { type: 'json' }
import en from '../../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../../app/data/books'
import { createLibrary } from '../../app/data/library'
import { addDays, isoDay } from '../../app/utils/dates'
import { LOCALE_KEY } from '../../app/utils/locale'
import { emailCooldown, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../../tests/support/stack'
import { signUpMember } from '../../tests/support/member'
import { expect, test } from '../fixtures'
import { SHELF_LIBRARY_SRC } from '../shelfOwner'
import { expectNoSideScroll, openProfile, recordedApple, signedIn, untilStill } from '../support'

/**
 * The German pass (issue #257): the app set to German, a seeded member walked through every screen of the main
 * journeys, in light and dark, 390 and 360 px wide. Not part of the default run (`LIBELLUS_E2E_GERMAN=1`, see
 * playwright.config.ts): it takes minutes and asserts nothing a pull request should wait on. For each screen it
 *
 *  - takes a screenshot (`$GERMAN_PASS_OUT`, default /tmp/german-pass),
 *  - fails softly when the page scrolls sideways (the same check the other flows make),
 *  - records the elements whose text is cut off (a button, tab, chip, segmented option, row label or title whose
 *    text is wider than its box and hidden or ellipsed),
 *  - records the visible text that is still an English string of en.json,
 *
 * and appends what it found to `findings.jsonl` in that folder; docs/i18n/german-pass.md is the table made of them.
 * A step that cannot be reached (a control renamed) is a finding too, not a crash. Run it on a throwaway stack:
 * `LIBELLUS_E2E_GERMAN=1 LIBELLUS_E2E_PORT=3104 pnpm exec playwright test e2e/i18n --workers=1`.
 */
test.skip(!process.env.LIBELLUS_E2E_GERMAN, 'the German pass runs only with LIBELLUS_E2E_GERMAN=1')

const OUT = process.env.GERMAN_PASS_OUT ?? '/tmp/german-pass'
const FINDINGS = join(OUT, 'findings.jsonl')

const flat = (node: unknown, path = ''): Record<string, string> =>
  typeof node === 'string' ? { [path]: node } : Object.assign({}, ...Object.entries(node as object).map(([k, v]) => flat(v, path ? `${path}.${k}` : k)))
const EN = flat(en)
const DE = flat(de)

/** Every English string worth recognising on a screen: whole messages and the forms of a plural, no placeholders in them. */
const ENGLISH = new Map<string, string>()
for (const [key, value] of Object.entries(EN)) {
  for (const form of value.split(' | ')) {
    const text = form.trim()
    if (!text || /[{@]/.test(text) || text.length < 4) continue
    const germanForms = (DE[key] ?? '').split(' | ').map((f) => f.trim().toLowerCase())
    if (germanForms.includes(text.toLowerCase())) continue // the same word in both languages (Genres, Offline, Name)
    ENGLISH.set(text.toLowerCase(), key)
  }
}
// Names and words the app keeps on purpose, and what the member's own data and the seeds' texts say.
const KEPT = new Set(['betterreads', 'goodreads', 'hardcover', 'apple books', 'open library', 'isbn', 'epub', 'csv', 'english', 'deutsch'])
const DATA = /Piranesi|Dune|Dispossessed|Ruin|Eden|Lathe|Reviewed|A book written for|A house of tides|A quiet book|Walls, and what|Susanna|Frank Herbert|Le Guin|Gwynne|Steinbeck|Ada Fenn|Clarke/i

function book(title: string, author: string, pages: number | null): BookSnapshot {
  return {
    title: runTitle(title),
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: pages,
    year: 1965,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: 'A book written for the German pass, with a description long enough to be a paragraph.',
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

type Finding = { run: string; screen: string; kind: string; element: string; english?: string; german: string; detail?: string }

class Pass {
  private n = 0
  constructor(
    readonly page: Page,
    readonly run: string,
  ) {}

  log(finding: Omit<Finding, 'run'>) {
    appendFileSync(FINDINGS, `${JSON.stringify({ run: this.run, ...finding })}\n`)
  }

  /** One screen: settle, screenshot, check. `where` names it in the findings and the file. */
  async screen(where: string, { full = false, english = true }: { full?: boolean; english?: boolean } = {}) {
    const page = this.page
    await untilStill(page).catch(() => undefined)
    const file = `${this.run}-${String(++this.n).padStart(2, '0')}-${where.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`
    await page.screenshot({ path: join(OUT, 'shots', file), fullPage: full })
    await expectNoSideScroll(page, `${this.run} ${where}`)

    const found = await page.evaluate(
      ({ english, kept, data, checkEnglish }) => {
        const out: { clipped: { element: string; text: string; box: number; need: number }[]; english: { element: string; text: string }[] } = { clipped: [], english: [] }
        const label = (el: Element) => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}`
        const visible = (el: Element) => {
          const box = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !el.closest('[aria-hidden="true"], [inert]')
        }
        // Text that is cut off: anything drawn with an ellipsis or a line clamp whose content is wider or taller than
        // its box. The member's own words (titles, names, the e-mail) are data, not copy, and are left out.
        for (const el of document.querySelectorAll('body *')) {
          if (!visible(el) || el.closest('.book-title, [data-userdata], .regal-books-row, .row-card__details, .regal-book-list')) continue
          const style = getComputedStyle(el)
          const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (!text || new RegExp(data, 'i').test(text) || /@libellus\.test/.test(text)) continue
          const ellipsis = style.textOverflow === 'ellipsis' && style.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1
          const clamped = style.webkitLineClamp !== 'none' && style.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1
          const chrome = style.overflowX === 'hidden' && el.matches('button, [role=tab], [role=radio], [role=switch], a[href], summary, label') && el.scrollWidth > el.clientWidth + 1
          if (ellipsis || clamped || chrome) out.clipped.push({ element: label(el), text: text.slice(0, 60), box: el.clientWidth, need: el.scrollWidth })
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const seen = new Set<string>()
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement
          const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (!parent || text.length < 4 || !visible(parent) || seen.has(text)) continue
          if (parent.closest('script, style, .book-title, [data-userdata]')) continue
          const lower = text.toLowerCase()
          if (kept.includes(lower) || new RegExp(data, 'i').test(text)) continue
          if (checkEnglish && english[lower] && !parent.closest('.regal-books-row, .row-card__details, .regal-book-list')) {
            seen.add(text)
            out.english.push({ element: label(parent), text })
          }
        }
        return out
      },
      { english: Object.fromEntries(ENGLISH), kept: [...KEPT], data: DATA.source, checkEnglish: english },
    )
    for (const c of found.clipped) this.log({ screen: where, kind: 'clipped', element: c.element, german: c.text, detail: `${c.need}px of text in a ${c.box}px box` })
    for (const e of found.english) this.log({ screen: where, kind: 'english', element: e.element, english: e.text, german: DE[ENGLISH.get(e.text.toLowerCase()) ?? ''] ?? '', detail: `en.json ${ENGLISH.get(e.text.toLowerCase())}` })
    return file
  }

  /** A step that may fail: its failure is a finding, the walk goes on. */
  async step(where: string, action: () => Promise<void>, options: { english?: boolean } = {}) {
    try {
      await action()
      await this.screen(where, options)
    } catch (error) {
      this.log({ screen: where, kind: 'unreached', element: '', german: '', detail: String(error instanceof Error ? error.message : error).split('\n')[0] })
      await this.page.keyboard.press('Escape').catch(() => undefined)
    }
  }

  async sheet(where: string, opener: string, sheet: string) {
    await this.step(where, async () => {
      await this.page.getByTestId(opener).first().scrollIntoViewIfNeeded()
      await this.page.getByTestId(opener).first().click()
      await expect(this.page.getByTestId(sheet)).toBeVisible()
    })
    await this.page.keyboard.press('Escape').catch(() => undefined)
    await expect(this.page.getByTestId(sheet)).toBeHidden().catch(() => undefined)
    await untilStill(this.page).catch(() => undefined)
  }
}

/** The member's Library: a Book in every state, as e2e/a11y.spec.ts seeds it. */
async function seed(page: Page, client: Parameters<typeof createLibrary>[0]) {
  const library = createLibrary(client)
  const add = async (snapshot: BookSnapshot, reads: [string, string, number | null, ('finished' | 'abandoned')?][]) => {
    const entry = (await library.addToLibrary(snapshot)).data!
    for (const [started, ended, rating, outcome = 'finished'] of reads) {
      await sql('insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating) values ($1, $2, $3, $4, $5)', [entry.id, started, ended, outcome, rating])
    }
    return entry
  }
  const genred = async (entry: { book: { id: string } }, ...genres: string[]) => {
    for (const [rank, genre] of genres.entries())
      await sql(`insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version) values ($1, $2, $3, 'wikidata', 1, 1)`, [entry.book.id, genre, rank + 1])
  }
  const today = isoDay()
  await genred(await add(book('Dune', 'Frank Herbert', 896), [['2025-04-12', '2025-05-17', 16]]), 'sci-fi', 'fantasy')
  await genred(await add(book('The Dispossessed', 'Ursula K. Le Guin', 387), [[addDays(today, -9), addDays(today, -3), 18]]), 'sci-fi', 'literary')
  await add(book('Piranesi', 'Susanna Clarke', 272), [['2024-11-27', '2024-12-29', null]])
  await add(book('The Lathe of Heaven', 'Ursula K. Le Guin', null), [['2024-03-02', '2024-03-20', null]])
  await add(book('Ruin', 'John Gwynne', 800), [['2025-02-04', '2025-02-04', null, 'abandoned']])
  await add(book('Up Next', 'Ursula K. Le Guin', 200), [])
  const eden = await add(book('East of Eden', 'John Steinbeck', 608), [])
  await library.startReading(eden.id, addDays(today, -2))
  const [read] = await sql<{ id: string }>('select id from public.reading_sessions where entry_id = $1', [eden.id])
  await sql('insert into public.reading_progress_days (session_id, day, start_page, end_page) values ($1, $2, 0, 24)', [read!.id, today])
  for (let i = 0; i < 3; i++) {
    await library.addToLibrary(book(`Reviewed ${i + 1}`, 'Ada Fenn', 200), {
      status: 'finished',
      startedOn: addDays(today, -20 - i),
      endedOn: addDays(today, -10 - i),
      rating: 16,
      review: 'A quiet book, and I would read it again.',
      reviewSpoilers: i === 0,
    })
  }
  await page.reload()
  await expect(page.getByTestId('home.title')).toBeVisible()
}

/** Two friends and a request, so Home's Your friends, the feed and People have something to show. */
async function befriend(page: Page, anna: { id: string; client: Parameters<typeof createLibrary>[0] }) {
  const [ida, ben, cleo] = [await signUpMember(), await signUpMember(), await signUpMember()]
  for (const [member, name] of [[anna, 'Anna'], [ida, 'Ida'], [ben, 'Ben'], [cleo, 'Cleo']] as const) {
    await sql(`update auth.users set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('name', $2::text) where id = $1`, [member.id, name])
  }
  for (const [follower, followee, accepted] of [[anna, ida, true], [anna, cleo, true], [ben, anna, false], [ida, anna, true]] as const) {
    await sql(`insert into public.follows (follower_id, followee_id, accepted_at) values ($1, $2, ${accepted ? 'now()' : 'null'})`, [follower.id, followee.id])
  }
  const today = isoDay()
  const idas = createLibrary(ida.client)
  await idas.addToLibrary(book('Piranesi', 'Susanna Clarke', 272), { status: 'finished', startedOn: addDays(today, -5), endedOn: today, rating: 18, review: 'A house of tides and statues.' })
  await idas.addToLibrary(book('Dune', 'Frank Herbert', 896), { status: 'finished', startedOn: addDays(today, -30), endedOn: addDays(today, -5), rating: 16 })
  await createLibrary(cleo.client).addToLibrary(book('Ruin', 'John Gwynne', 800))
  await sql(`update public.activity set visible_at = now() - interval '1 second' where member_id = any($1)`, [[ida.id, cleo.id, anna.id]])
  await page.reload()
  return ida
}

/** A plain address change: the walk crosses sheets and pushed pages, so the flows' history-aware `goto` would wait for layers a sheet left behind. */
const go = async (page: Page, url: string) => {
  await page.goto(url)
  await untilStill(page).catch(() => undefined)
}

const SIZES = [
  { name: '390', viewport: { width: 390, height: 844 } },
  { name: '360', viewport: { width: 360, height: 780 } },
]
const THEMES = ['light', 'dark'] as const

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`German, ${size.name} px, ${theme}`, () => {
      test.use({ locale: 'de-DE', colorScheme: theme, viewport: size.viewport })

      test(`the main journeys`, async ({ page }) => {
        test.setTimeout(10 * 60_000)
        mkdirSync(join(OUT, 'shots'), { recursive: true })
        const run = `${size.name}-${theme}`
        const pass = new Pass(page, run)
        await recordedApple(page)
        // The published library file a build with Regal asks for (e2e/contact.spec.ts does the same): answered from the fixture.
        await page.route(SHELF_LIBRARY_SRC, (route) =>
          route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(new URL('../../tests/fixtures/shelf/library.json', import.meta.url), 'utf8') }),
        )
        await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), ['libellus-theme', theme])

        // The way in, signed out: German from the phone's language, nothing chosen.
        await page.goto('/sign-in')
        await expect(page.getByTestId('signIn.title')).toHaveText(de.signIn.title)
        expect(await page.evaluate((key) => localStorage.getItem(key), LOCALE_KEY)).toBeNull()
        await pass.screen('sign-in')
        await pass.step('sign-in-error-offline', async () => {
          await page.getByTestId('signIn.email').fill('ada@libellus.test')
          await page.context().setOffline(true)
          await page.getByTestId('signIn.submit').click()
          await expect(page.getByTestId('signIn.error')).toBeVisible()
        })
        await page.context().setOffline(false)
        await pass.step('sign-up', async () => {
          await page.goto('/sign-up')
          await expect(page.getByTestId('signUp.title')).toBeVisible()
        })
        await pass.step('sign-up-invite-error', async () => {
          await page.getByTestId('signUp.email').fill('ada@libellus.test')
          await page.getByTestId('signUp.inviteCode').fill('NOT-A-CODE')
          await page.getByTestId('signUp.submit').click()
          await expect(page.getByTestId('signUp.inviteError')).toBeVisible()
        })
        await pass.step('legal-privacy', async () => {
          await page.goto('/privacy')
          await expect(page.getByTestId('legal.title')).toBeVisible()
        })

        // Signed in: first the empty states.
        await emailCooldown()
        const member = await signedIn(page)
        await pass.screen('home-empty')
        await pass.step('library-empty', async () => {
          await page.getByTestId('shell.tab.library').click()
          await page.waitForTimeout(500)
        })
        await go(page, '/')

        // Then a Library with everything in it, and friends.
        await seed(page, member.client)
        await befriend(page, member)
        await expect(page.getByTestId('home.title')).toBeVisible()
        await pass.screen('home-top')
        await pass.step('home-bottom', async () => {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        })
        await pass.step('home-friends', async () => {
          await page.getByTestId('home.friends').scrollIntoViewIfNeeded()
          await expect(page.getByTestId('home.friendsRow').first()).toBeVisible()
        })
        await pass.sheet('home-tally-sheet', 'home.tally', 'homeTally')

        await pass.step('search-palette', async () => {
          await page.getByTestId('shell.tab.search').click()
          await expect(page.getByTestId('search.query')).toBeFocused()
        })
        await pass.step('search-results', async () => {
          await page.getByTestId('search.query').fill('Piranesi')
          await expect(page.getByTestId('search.result').first()).toBeVisible()
        })
        await pass.step('search-offline', async () => {
          await page.context().setOffline(true)
          await page.getByTestId('search.query').fill('Dune')
          await page.waitForTimeout(500)
        })
        await page.context().setOffline(false)

        // The Library: three segments, the view bar, the sort and filter sheets.
        await go(page, '/library')
        for (const segment of ['want_to_read', 'reading', 'finished']) {
          await pass.step(`library-${segment}`, async () => {
            await page.getByTestId(`library.segment.${segment}`).click()
            await expect(page.getByTestId('library.view')).toBeVisible()
          })
        }
        await pass.sheet('library-sort-sheet', 'library.view.sort', 'librarySort')
        await pass.sheet('library-filter-sheet', 'library.view.filter', 'libraryFilter')

        // A Book being read: page, options, Update progress, Finish; a wanted one: Start; a finished one; Change edition; Add.
        await go(page, '/')
        await pass.step('book-reading', async () => {
          await page.getByTestId('home.entry').first().click()
          await expect(page.getByTestId('book.title')).toBeVisible()
        })
        await pass.sheet('book-options-sheet', 'book.options', 'bookOptions')
        await pass.sheet('book-progress-sheet', 'book.updateProgress', 'progress')
        await pass.step('book-finish-sheet', async () => {
          await page.getByTestId('book.updateProgress').click()
          await page.getByTestId('progress.finish').click()
          await expect(page.getByTestId('finish')).toBeVisible()
        })
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await untilStill(page).catch(() => undefined)
        await pass.step('book-options-edition', async () => {
          await page.getByTestId('book.options').click()
          await page.getByTestId('bookOptions.changeEdition').click()
          await expect(page.getByTestId('edition')).toBeVisible()
        })
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await go(page, '/library')
        await pass.step('book-wanted', async () => {
          await page.getByTestId('library.segment.want_to_read').click()
          await page.getByTestId('library.entry').first().click()
          await expect(page.getByTestId('book.title')).toBeVisible()
        })
        await pass.sheet('book-start-sheet', 'book.start', 'start')
        await go(page, '/library')
        await pass.step('book-finished', async () => {
          await page.getByTestId('library.segment.finished').click()
          await page.getByTestId('library.entry').first().click()
          await expect(page.getByTestId('book.title')).toBeVisible()
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        })
        await pass.step('book-add-sheet', async () => {
          await page.getByTestId('shell.tab.search').click()
          await page.route(/\/rest\/v1\/rpc\/search_books/, async (route) => route.fulfill({ response: await route.fetch(), body: '[]' }))
          await page.getByTestId('search.query').fill('Piranesi')
          await page.locator('[data-testid="search.results"] > li[data-near-key]').first().getByTestId('search.result').click()
          await page.getByTestId('book.add').click()
          await expect(page.getByTestId('add')).toBeVisible()
        })
        await page.keyboard.press('Escape')

        // Collections.
        await go(page, '/collections')
        await pass.step('collections-empty', async () => {
          await expect(page.getByTestId('collections.title')).toBeVisible()
        })
        await pass.step('collections-create-sheet', async () => {
          await page.getByTestId('collections.new').first().click()
          await page.keyboard.type('Favoriten')
        })
        await page.keyboard.press('Escape')

        // The Profile: every row, the Contact and Privacy sheets, the language row, the shelf.
        await go(page, '/')
        await openProfile(page)
        await pass.screen('profile-top')
        await pass.step('profile-account', async () => {
          await page.getByTestId('profile.account').scrollIntoViewIfNeeded()
          await page.getByTestId('profile.language').scrollIntoViewIfNeeded()
        })
        await pass.step('profile-bottom', async () => {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        })
        await pass.sheet('profile-contact-sheet', 'profile.contact', 'contact')
        await pass.sheet('profile-name-sheet', 'profile.name', 'accountName')
        await pass.sheet('profile-links-sheet', 'profile.links', 'links')
        await pass.sheet('profile-privacy-sheet', 'profile.privacy', 'privacy')
        await pass.sheet('profile-follow-link-sheet', 'profile.followLink', 'followLink')
        await pass.step('profile-year', async () => {
          await go(page, `/profile/${isoDay().slice(0, 4)}`)
          await expect(page.getByTestId('yearInReview.title')).toBeVisible()
        })

        // Friends and People, a member, the shelf.
        await pass.step('friends-feed', async () => {
          await go(page, '/friends')
          await expect(page.getByTestId('friends.entry').first()).toBeVisible()
        })
        await pass.step('friends-people-requests', async () => {
          await go(page, '/friends/people')
          await page.getByTestId('people.segment.requests').click()
          await expect(page.getByTestId('people.row').first()).toBeVisible()
        })
        await pass.step('friends-people-following', async () => {
          await page.getByTestId('people.segment.following').click()
          await expect(page.getByTestId('people.row').first()).toBeVisible()
        })
        await pass.sheet('friends-member-sheet', 'people.rowMore', 'memberSheet')
        await pass.step('shelf', async () => {
          await go(page, '/profile/shelf')
          await page.waitForTimeout(800)
        })
        await pass.step('import', async () => {
          await go(page, '/import')
          await expect(page.getByTestId('import.title')).toBeVisible()
        })
        await pass.step('error-offline-profile', async () => {
          await go(page, '/')
          await page.context().setOffline(true)
          await page.getByTestId('shell.avatar').click()
          await page.waitForTimeout(500)
        })
        await page.context().setOffline(false)

        // The language row, at the end: English, and back.
        await go(page, '/')
        await openProfile(page)
        await pass.step('language-row-english', async () => {
          await page.getByTestId('profile.language').scrollIntoViewIfNeeded()
          await page.getByTestId('profile.languageChoice.en').click()
          await expect(page.getByTestId('profile.language')).toContainText(en.language.row)
        }, { english: false })
        await page.getByTestId('profile.languageChoice.de').click()
        await expect(page.getByTestId('profile.language')).toContainText(de.language.row)
      })
    })
  }
}
