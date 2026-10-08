import { expect } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import type { BookSnapshot } from '../app/data/books'
import { createCollections } from '../app/data/collections'
import { createLibrary, type LibraryEntry } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { appleAnswer } from '../tests/support/apple'
import { sql, runTitle, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { test } from './fixtures'
import { goto, recordedApple, signedIn } from './support'

/**
 * Changing an edition (#41): a member's finished book has the Placeholder
 * cover; from the book page's options she opens Change edition, picks another
 * edition of the work (OpenLibrary's work editions answer from the recording,
 * e2e/support.ts), and the book page shows its cover, while the read, its
 * Rating and review and the book's Collection stay. An edition she already
 * has as another book is refused with a clear message. The Library is the real
 * local stack; the entries are made through the repository so the Book has
 * the work key the recordings know. The change animates on the same page: the
 * old cover lies over the new one and fades out into it (#61). With
 * docs/parity.md this is the behavioural reference for Change edition.
 */

test.beforeEach(async ({ page }) => {
  await recordedApple(page)
})

const PIRANESI_WORK = 'OL20893680W'
/** Two editions in the recording: the Spanish one (2021, 272 pages) and the Italian one, both with a cover. */
const SPANISH = { isbn13: '9788418363283', cover: 'https://covers.openlibrary.org/b/id/15240267-L.jpg' }
const ITALIAN = { isbn13: '9791259670021' }

function piranesi(fields: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: runTitle('Piranesi'),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 245,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    // No image: the Placeholder cover, as the owner's imported books have.
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: PIRANESI_WORK,
    ...fields,
  }
}

test('a member changes the edition of a finished book: the cover changes, its read and collection stay', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const today = isoDay()
  const entry = (await library.addToLibrary(piranesi(), {
    status: 'finished', startedOn: addDays(today, -40), endedOn: addDays(today, -30), rating: 18, review: 'The House is kind.',
  })).data as LibraryEntry
  const collections = createCollections(member.client)
  const shelf = (await collections.create(runTitle('Favourites'))).data!
  expect((await collections.addEntry(shelf.id, entry.book)).error).toBeNull()

  await goto(page, `/book/${entry.book.id}`)
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  // The Placeholder cover: no image on the page yet.
  await expect(page.getByTestId('book.hero').locator('img')).toHaveCount(0)

  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.changeEdition').click()
  await expect(page.getByTestId('edition')).toBeVisible()

  // The current edition is first, marked and picked; Change waits for another.
  const candidates = page.getByTestId('edition.candidate')
  await expect(candidates.first()).toContainText(en.book.edition.current)
  await expect(candidates.first()).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('edition.action')).toBeDisabled()
  // The work's editions arrive, the Spanish one with its language, year and pages.
  const spanish = candidates.filter({ hasText: 'Spanish' })
  await expect(spanish).toHaveCount(1)
  await expect(spanish.getByTestId('edition.candidateFacts')).toHaveText(/Spanish.*2021.*272 pages/)
  await expect(page.getByTestId('edition.loading')).toBeHidden()
  // The recording's 23 editions, three of them listed twice, besides the current one.
  expect(await candidates.count()).toBeGreaterThanOrEqual(20)
  // No source is ever named.
  await expect(page.getByTestId('edition')).not.toContainText(/Apple|Open ?Library/)

  await spanish.click()
  await expect(spanish).toHaveAttribute('aria-checked', 'true')
  await expect(candidates.first()).toHaveAttribute('aria-checked', 'false')
  // The page stays the same page through the change (marked, to tell), every
  // frame says what lies over its hero, and the fade laid on the old cover is
  // kept with what became of it. The fade is told by its animation, not by the
  // frames drawn during it: on a starved runner a frame can take longer than
  // `standard`, and the whole fade falls between two of them.
  await page.getByTestId('book.hero').evaluate((hero) => {
    hero.setAttribute('data-before-change', '')
    const seen: string[] = []
    const fades: { from: unknown; to: unknown; duration: unknown; events: string[] }[] = []
    Object.assign(window, { __was: seen, __fades: fades })
    const look = () => {
      const was = hero.querySelector('[data-edition-was] > *')
      seen.push(was ? `${was.querySelector('.cloth') ? 'cloth' : 'image'} ${Number(getComputedStyle(was).opacity).toFixed(1)}` : 'none')
      if (seen.length < 600) requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
    // The old hero is laid in, its fade set on it in the same task: seen before any frame.
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node instanceof HTMLElement)
            for (const animation of node.getAnimations()) {
              const keyframes = (animation.effect as KeyframeEffect).getKeyframes()
              const fade = { from: keyframes[0]?.opacity, to: keyframes.at(-1)?.opacity, duration: animation.effect!.getTiming().duration, events: [] as string[] }
              for (const type of ['finish', 'cancel']) animation.addEventListener(type, () => fade.events.push(type))
              fades.push(fade)
            }
    }).observe(hero.querySelector('[data-edition-was]')!, { childList: true })
  })
  await page.getByTestId('edition.action').click()
  await expect(page.getByTestId('edition')).toBeHidden()
  // The old cover (the Placeholder) lies over the new one and fades out into it (docs/MOTION.md, Change edition):
  // it shows whole while the sheet falls away, then only ever fades, over `standard`, played to its end.
  await expect(page.locator('[data-edition-was] > *')).toHaveCount(0)
  await expect(page.getByTestId('book.hero')).toHaveAttribute('data-before-change', '')
  const { frames, fades, standard } = await page.evaluate(() => ({
    frames: (window as unknown as { __was: string[] }).__was,
    fades: (window as unknown as { __fades: unknown[] }).__fades,
    // In ms: the dev server writes the token as `250ms`, the build as `.25s`.
    standard: ((value) => parseFloat(value) * (/ms$/.test(value) ? 1 : 1000))(getComputedStyle(document.documentElement).getPropertyValue('--duration-standard').trim()),
  }))
  const seen = [...new Set(frames)]
  expect(seen[0]).toBe('none')
  expect(seen).toContain('cloth 1.0')
  expect(seen.every((frame) => frame === 'none' || frame.startsWith('cloth '))).toBe(true)
  const opacities = frames.filter((frame) => frame !== 'none').map((frame) => Number(frame.split(' ')[1]))
  expect(opacities).toEqual([...opacities].sort((a, b) => b - a))
  expect(fades).toEqual([{ from: '1', to: '0', duration: standard, events: expect.arrayContaining(['finish']) }])
  expect((fades[0] as { events: string[] }).events[0]).toBe('finish')

  // The page is the new Book's now, with its cover; the read and the collection are still there.
  const [changed] = await sql<{ book_id: string; isbn13: string; cover_url: string; cover_thumbhash: string | null }>(
    `select e.book_id, b.isbn13, b.cover_url, b.cover_thumbhash from public.library_entries e
       join public.books b on b.id = e.book_id where e.id = $1`,
    [entry.id],
  )
  expect(changed).toMatchObject({ isbn13: SPANISH.isbn13, cover_url: SPANISH.cover, cover_thumbhash: expect.any(String) })
  await expect(page).toHaveURL(new RegExp(`/book/${changed!.book_id}$`))
  await expect(page.getByTestId('book.hero').locator('img').first()).toHaveAttribute('src', /covers\.openlibrary\.org\/b\/id\/15240267/)
  await expect(page.getByTestId('book.facts')).toContainText('272 pages')
  await expect(page.getByTestId('book.status')).toHaveText(en.status.finished)
  await expect(page.getByTestId('book.rating')).toBeVisible()
  await expect(page.getByTestId('history.session')).toHaveCount(1)
  await expect(page.getByTestId('history')).toContainText('The House is kind.')
  await expect(page.getByTestId('book.collection')).toHaveText(runTitle('Favourites'))

  // The Library and the Collection show the new cover too.
  await page.getByTestId('shell.tab.library').click()
  await page.getByTestId('library.segment.finished').click()
  await expect(page.getByTestId('library.entry').first().locator('img')).toHaveAttribute('src', /15240267/)
  const [kept] = await sql<{ reads: number; on_shelf: boolean }>(
    `select (select count(*)::int from public.reading_sessions where entry_id = $1) as reads,
            exists (select 1 from public.collection_entries where entry_id = $1 and collection_id = $2) as on_shelf`,
    [entry.id, shelf.id],
  )
  expect(kept).toEqual({ reads: 1, on_shelf: true })
})

test('an edition she already has as another book is refused, and the book keeps its edition', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  // Its own title and author, so the other flow's Catalogue search never finds these Books.
  const entry = (await library.addToLibrary(piranesi({ title: runTitle('Kindred'), authors: ['Ada Example'] }))).data!
  // She holds the Italian edition already, as another book.
  const other = await library.addToLibrary(piranesi({
    title: runTitle('Kindred, in Italian'), authors: ['Ada Example'], isbn13: ITALIAN.isbn13, language: 'it', openLibraryWorkKey: null,
  }))
  expect(other.error).toBeNull()

  await goto(page, `/book/${entry.book.id}`)
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.changeEdition').click()
  const italian = page.getByTestId('edition.candidate').filter({ hasText: 'Italian' })
  await italian.click()
  await page.getByTestId('edition.action').click()

  await expect(page.getByTestId('edition.error')).toHaveText(en.library.error.edition_in_library)
  await expect(page.getByTestId('edition')).toBeVisible()
  await page.getByTestId('edition.cancel').click()
  await expect(page).toHaveURL(new RegExp(`/book/${entry.book.id}$`))
  expect((await library.entry(entry.id)).data!.book.id).toBe(entry.book.id)
})

test('an Apple edition has no language to show: its row starts with the year, with no dash or empty slot (#104)', async ({ page }) => {
  // Apple answers the title search from the "Piranesi" recording whatever the title: ebooks, none with a language.
  await page.route('https://itunes.apple.com/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(appleAnswer(new URL(`https://itunes.apple.com/search?term=piranesi&country=${new URL(route.request().url()).searchParams.get('country')}`))),
    }),
  )
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const entry = (await library.addToLibrary(piranesi({ language: null, openLibraryWorkKey: null }), { status: 'want_to_read' })).data as LibraryEntry

  await goto(page, `/book/${entry.book.id}`)
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.changeEdition').click()
  await expect(page.getByTestId('edition')).toBeVisible()
  await expect(page.getByTestId('edition.loading')).toBeHidden()

  const apple = page.getByTestId('edition.candidate').filter({ hasText: en.book.formatFact.ebook })
  expect(await apple.count()).toBeGreaterThan(0)
  const facts = await apple.getByTestId('edition.candidateFacts').evaluateAll((rows) =>
    rows.map((row) => ({ text: row.textContent ?? '', parts: [...row.querySelectorAll(':scope > span:not([aria-hidden])')].map((part) => part.textContent ?? '') })),
  )
  for (const { text, parts } of facts) {
    // The facts are the edition's own (year, pages, "ebook", publisher): never a dash or an empty part.
    expect(parts.every((part) => part.trim() !== ''), text).toBe(true)
    expect(text).not.toMatch(/[–—-]/)
  }
  // Rows only Apple knows (OpenLibrary has nothing to fill in) start with the year.
  expect(facts.filter(({ parts }) => /^\d{4}$/.test(parts[0] ?? '')).length).toBeGreaterThan(0)
})

/** The sheet's format row says what it does in a line of its own, and its words as the member sets them. */
const said = (format: 'audiobook' | 'paperback' | 'ebook' | 'hardcover') => en.book.edition.formatSaid.replace('{format}', en.book.formatFact[format])

async function openChangeEdition(page: Parameters<typeof signedIn>[0], entry: LibraryEntry) {
  await goto(page, `/book/${entry.book.id}`)
  await page.getByTestId('book.options').click()
  await page.getByTestId('bookOptions.changeEdition').click()
  await expect(page.getByTestId('edition')).toBeVisible()
  await expect(page.getByTestId('edition.loading')).toBeHidden()
}

test('the format row says what it does, shows its effect at once and goes along with the change (and Read as follows)', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const entry = (await library.addToLibrary(piranesi(), { status: 'finished', startedOn: '2026-01-01', endedOn: '2026-01-09', rating: 16 })).data as LibraryEntry
  expect((await library.setReadAs(entry.id, 'physical')).error).toBeNull()

  await openChangeEdition(page, entry)
  // It is not a filter, and says so before she touches it.
  await expect(page.getByTestId('edition.formatHelp')).toHaveText(en.book.edition.formatHelp)
  await expect(page.getByTestId('edition.format')).toHaveAccessibleDescription(en.book.edition.formatHelp)
  const candidates = page.getByTestId('edition.candidate')
  const count = await candidates.count()

  // The Spanish edition's source says nothing about its format: none is lit, and it does not need to be.
  const spanish = candidates.filter({ hasText: 'Spanish' })
  await spanish.click()
  await expect(page.getByTestId('edition.format.ebook')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('edition.action')).toHaveText(en.book.edition.action)

  // Saying it is an audiobook filters nothing, changes the picked row at once, and the action says it goes along.
  await page.getByTestId('edition.format.audiobook').click()
  await expect(candidates).toHaveCount(count)
  await expect(page.getByTestId('edition.formatHelp')).toHaveText(said('audiobook'))
  await expect(spanish.getByTestId('edition.candidateFacts')).toContainText(en.book.formatFact.audiobook)
  await expect(candidates.first().getByTestId('edition.candidateFacts')).toContainText(en.book.formatFact.ebook)
  await expect(page.getByTestId('edition.action')).toHaveText(en.book.edition.changeAndSave)

  // Picking another edition forgets it; picking this one again starts from what its source says.
  await candidates.first().click()
  await expect(page.getByTestId('edition.formatHelp')).toHaveText(en.book.edition.formatHelp)
  await expect(page.getByTestId('edition.action')).toHaveText(en.book.edition.action)
  await spanish.click()
  await page.getByTestId('edition.format.audiobook').click()
  await page.getByTestId('edition.action').click()
  await expect(page.getByTestId('edition')).toBeHidden()

  // The format she said is the one saved with the new edition, and her Read as follows it.
  await expect(page.getByTestId('book.facts')).toContainText(en.book.formatFact.audiobook)
  // Read as is in the Book's options sheet (#211), and it followed the format she said.
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions.readAs.audiobook')).toHaveAttribute('aria-checked', 'true')
  const [saved] = await sql<{ format_override: string | null; read_as: string | null; format: string | null }>(
    `select e.format_override, e.read_as, b.format from public.library_entries e join public.books b on b.id = e.book_id where e.id = $1`,
    [entry.id],
  )
  expect(saved).toEqual({ format_override: 'audiobook', read_as: 'audiobook', format: null })
})

test('a format she does not change is not said: the action stays Change, and her Read as stays where it was', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const entry = (await library.addToLibrary(piranesi(), { status: 'finished', startedOn: '2026-01-01', endedOn: '2026-01-09', rating: 16 })).data as LibraryEntry
  // Her own word, about how she read it; the Spanish edition does not say what it is.
  expect((await library.setReadAs(entry.id, 'audiobook')).error).toBeNull()

  await openChangeEdition(page, entry)
  await page.getByTestId('edition.candidate').filter({ hasText: 'Spanish' }).click()
  await expect(page.getByTestId('edition.action')).toHaveText(en.book.edition.action)
  await page.getByTestId('edition.action').click()
  await expect(page.getByTestId('edition')).toBeHidden()

  await expect(page.getByTestId('book.facts')).toContainText('272 pages')
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions.readAs.audiobook')).toHaveAttribute('aria-checked', 'true')
  const [saved] = await sql<{ format_override: string | null; read_as: string | null }>(
    `select format_override, read_as from public.library_entries where id = $1`,
    [entry.id],
  )
  expect(saved).toEqual({ format_override: null, read_as: 'audiobook' })
})

test('an edition read another way presets Read as, and her own edition\'s format saves on its own', async ({ page }) => {
  const member = await signedIn(page)
  const library = createLibrary(member.client)
  const entry = (await library.addToLibrary(piranesi(), { status: 'finished', startedOn: '2026-01-01', endedOn: '2026-01-09', rating: 16 })).data as LibraryEntry
  // An Apple edition is an ebook; she said she read it as one.
  expect((await library.setReadAs(entry.id, 'ebook')).error).toBeNull()

  await openChangeEdition(page, entry)
  await page.getByTestId('edition.candidate').filter({ hasText: 'Spanish' }).click()
  await page.getByTestId('edition.format.hardcover').click()
  await page.getByTestId('edition.action').click()
  await expect(page.getByTestId('edition')).toBeHidden()
  await expect(page.getByTestId('book.facts')).toContainText(en.book.formatFact.hardcover)
  // Paper now: the ebook word gave way to the new edition's — in the options sheet (#211).
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions.readAs.physical')).toHaveAttribute('aria-checked', 'true')

  // With her own edition picked the action is Save, and saving a format leaves Read as to her.
  // The sheet it was opened from is already up: it makes way for the change.
  await page.getByTestId('bookOptions.changeEdition').click()
  await expect(page.getByTestId('edition.action')).toBeDisabled()
  await page.getByTestId('edition.format.paperback').click()
  await expect(page.getByTestId('edition.action')).toHaveText(en.book.edition.save)
  await expect(page.getByTestId('edition.formatHelp')).toHaveText(said('paperback'))
  await page.getByTestId('edition.action').click()
  await expect(page.getByTestId('edition')).toBeHidden()
  await expect(page.getByTestId('book.facts')).toContainText(en.book.formatFact.paperback)
  await page.getByTestId('book.options').click()
  await expect(page.getByTestId('bookOptions.readAs.physical')).toHaveAttribute('aria-checked', 'true')
})

test.describe('the list of editions moves in', () => {
  // The flows run with Reduce Motion; this one is about what is drawn on the way.
  test.use({ reducedMotion: 'no-preference' })

  test('editions that arrive open their room and fade in; the current row stays where it is', async ({ page }) => {
    const member = await signedIn(page)
    const entry = (await createLibrary(member.client).addToLibrary(piranesi())).data as LibraryEntry
    await goto(page, `/book/${entry.book.id}`)
    await page.getByTestId('book.options').click()

    // Every frame from the tap on: where the first row sits in its list. And, for every row that
    // arrives, the animation it carries — its room opening and its fade — read from the
    // animation itself: a frame drawn while one runs may never come on a starved runner, and a
    // whole `standard` fade then falls between two frames (docs/MOTION.md, as above).
    await page.evaluate(() => {
      type Done = { from: unknown; to: unknown; duration: unknown; events: string[] }
      // `place`: where the first row sits in its list — not under the hint, whose own box can
      // change under it (a late font), which says nothing about the row.
      const frames: { place: number | null; rows: number }[] = []
      const arriving: { index: number; room: Done; fade: Done }[] = []
      Object.assign(window, { __editionFrames: frames, __editionArriving: arriving })

      /** What a transition of one property does, and how it ends (`null` when it does not run). */
      const transition = (row: HTMLElement, property: string): Done | null => {
        const animation = row.getAnimations().find((one) => (one as CSSTransition).transitionProperty === property)
        if (!animation) return null
        const keyframes = (animation.effect as KeyframeEffect).getKeyframes() as Record<string, string>[]
        const events: string[] = []
        for (const type of ['finish', 'cancel']) animation.addEventListener(type, () => events.push(type))
        return { from: keyframes[0]?.[property], to: keyframes.at(-1)?.[property], duration: animation.effect!.getTiming().duration, events }
      }

      const look = () => {
        const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="edition.candidate"]')]
        const list = rows[0]?.parentElement
        frames.push({
          place: rows[0] && list ? Math.round((rows[0].getBoundingClientRect().top - list.getBoundingClientRect().top) * 10) / 10 : null,
          rows: rows.length,
        })
        if (frames.length < 900) requestAnimationFrame(look)
      }
      requestAnimationFrame(look)

      // Index 0 is the current edition: it comes with the sheet and animates nothing in, so only
      // the rows that arrive under it are read. Page copies are made off the document, so only
      // what is connected counts.
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes)
            if (node instanceof HTMLElement && node.isConnected && node.dataset.testid === 'edition.candidate') {
              const index = [...document.querySelectorAll('[data-testid="edition.candidate"]')].indexOf(node)
              const room = transition(node, 'height')
              const fade = transition(node, 'opacity')
              if (index > 0 && room && fade) arriving.push({ index, room, fade })
            }
      }).observe(document.body, { childList: true, subtree: true })
    })
    await page.getByTestId('bookOptions.changeEdition').click()
    await expect(page.getByTestId('edition.loading')).toBeVisible()
    await expect(page.getByTestId('edition.loading')).toBeHidden()
    await expect.poll(() => page.getByTestId('edition.candidate').count()).toBeGreaterThan(20)
    // Let the last room settle (the list says it is moving while one does).
    await expect(page.getByTestId('edition').locator('[data-moving]')).toHaveCount(0)

    const { frames, arriving, standard } = await page.evaluate(() => ({
      frames: (window as unknown as { __editionFrames: { place: number | null; rows: number }[] }).__editionFrames,
      arriving: (window as unknown as { __editionArriving: { index: number; room: { from: unknown; to: unknown; duration: unknown; events: string[] }; fade: { from: unknown; to: unknown; duration: unknown; events: string[] } }[] }).__editionArriving,
      // In ms: the dev server writes the token as `250ms`, the build as `.25s`.
      standard: ((value) => parseFloat(value) * (/ms$/.test(value) ? 1 : 1000))(getComputedStyle(document.documentElement).getPropertyValue('--duration-standard').trim()),
    }))
    // The current row never moved in its list once the others began to arrive; what came before
    // is the sheet's own layout settling. A rect read while the sheet rides up comes back
    // rounded, so a sub-pixel spread is not a move.
    const arrived = frames.findIndex((frame) => frame.rows > 1)
    expect(arrived).toBeGreaterThan(-1)
    const places = frames.slice(arrived).map((frame) => frame.place).filter((value): value is number => value !== null)
    expect(places.length).toBeGreaterThan(0)
    expect(Math.max(...places) - Math.min(...places)).toBeLessThan(1)
    // Every other row arrived opening its room and fading in over `standard`, played to its
    // end: one arrival per row the sheet ended with, after the current one, in its place.
    expect(arriving).toHaveLength((await page.getByTestId('edition.candidate').count()) - 1)
    expect(arriving.map((row) => row.index)).toEqual(arriving.map((_, index) => index + 1))
    for (const row of arriving) {
      expect(row.room).toEqual({ from: '0px', to: expect.stringMatching(/^\d+(\.\d+)?px$/), duration: standard, events: expect.arrayContaining(['finish']) })
      expect(row.fade).toEqual({ from: '0', to: '1', duration: standard, events: expect.arrayContaining(['finish']) })
      expect([...row.room.events, ...row.fade.events]).not.toContain('cancel')
    }
    await expect(page.getByTestId('edition.candidate').last()).toHaveCSS('opacity', '1')
  })
})
