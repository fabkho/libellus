import { mkdirSync, readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import en from '../i18n/locales/en.json' with { type: 'json' }
import de from '../i18n/locales/de.json' with { type: 'json' }
import { sql } from '../tests/support/stack'
import { test } from './fixtures'
import { expectAccessible, expectNoSideScroll, goto, signedIn } from './support'

/**
 * "Notify me when it's done" on the import page (Web Push, stores/importPush.ts, docs/parity.md): offered once her job is live, never
 * before; the browser's permission is asked on her tap and not on load; then "We'll notify you" (with a way to turn it off), the browser's
 * "no" is told, and an iPhone in a Safari tab is told how to get there. The browser's push side is a stand-in (below); the worker and the
 * sender are tested on their own (tests/push-worker.test.ts, supabase/functions/import-job).
 * `PUSH_SHOTS=<dir>` also writes the screenshots of the two states (light and dark, 390 px).
 */

test.describe.configure({ mode: 'serial' })

const FILE = readFileSync(new URL('../tests/fixtures/goodreads/library_export.csv', import.meta.url))

/**
 * The browser's Web Push, as an installed app on a phone has it: `Notification` (what she answered stays across a reload, as the browser keeps
 * it), a `PushManager` that subscribes to an address the push service would have made, and the page's registration. Counts are `window.__push`.
 */
async function pushBrowser(page: Page, { permission = 'default', answer = 'granted', installed = true }: { permission?: string; answer?: string; installed?: boolean } = {}) {
  await page.addInitScript(
    ({ permission, answer, installed }) => {
      const store = window.localStorage
      const counts = ((window as unknown as { __push: { asked: number; subscribed: number } }).__push = { asked: 0, subscribed: 0 })
      if (installed) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
      const permissionNow = () => store.getItem('fake-push.permission') ?? permission
      class FakeNotification {
        static get permission() {
          return permissionNow()
        }
        static async requestPermission() {
          counts.asked++
          if (permissionNow() === 'default') store.setItem('fake-push.permission', answer)
          return permissionNow()
        }
      }
      Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true })
      Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true, writable: true })
      const subscription = () => {
        const endpoint = store.getItem('fake-push.subscription')
        if (!endpoint) return null
        return {
          endpoint,
          toJSON: () => ({ endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }),
          unsubscribe: async () => (store.removeItem('fake-push.subscription'), true),
        }
      }
      const registration = {
        pushManager: {
          getSubscription: async () => subscription(),
          subscribe: async () => {
            counts.subscribed++
            store.setItem('fake-push.subscription', `https://push.example.test/send/${crypto.randomUUID()}`)
            return subscription()
          },
        },
      }
      const real = navigator.serviceWorker
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: new Proxy(real ?? {}, {
          get(target, key) {
            if (key === 'getRegistration') return async () => registration
            if (key === 'ready') return Promise.resolve(registration)
            const value = Reflect.get(target, key)
            return typeof value === 'function' ? value.bind(target) : value
          },
        }),
      })
    },
    { permission, answer, installed },
  )
}

const asked = (page: Page) => page.evaluate(() => (window as unknown as { __push: { asked: number; subscribed: number } }).__push)

async function startImport(page: Page) {
  await goto(page, '/import')
  await expect(page.getByTestId('import.choose')).toBeVisible()
  // Nothing about notifications before there is a job to be told about.
  await expect(page.getByTestId('import.notify')).toHaveCount(0)
  await page.getByTestId('import.file').setInputFiles({ name: 'goodreads.csv', mimeType: 'text/csv', buffer: FILE })
  await expect(page.getByTestId('import.running')).toBeVisible()
}

const subscriptions = async (memberId: string) => await sql<{ endpoint: string; locale: string }[]>('select endpoint, locale from public.push_subscriptions where member_id = $1', [memberId])

async function shot(page: Page, name: string) {
  const dir = process.env.PUSH_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(150)
    await page.screenshot({ path: `${dir}/${name}-${scheme}.png` })
  }
  await page.emulateMedia({ colorScheme: 'light' })
}

test.afterEach(async () => {
  await sql('delete from public.import_queue')
})

test('the button comes with the job, asks nothing until she taps, then says she will be told, and can be turned off', async ({ page }) => {
  await pushBrowser(page)
  const member = await signedIn(page)
  await startImport(page)

  const notify = page.getByTestId('import.notify')
  await expect(notify).toHaveAttribute('data-view', 'ask')
  const button = page.getByTestId('import.notify.enable')
  await expect(button).toHaveText(en.import.notify.ask)
  await expect(page.getByTestId('import.notify.hint')).toHaveText(en.import.notify.askHint)
  // Loading the page and showing the button asked the browser nothing.
  expect(await asked(page)).toEqual({ asked: 0, subscribed: 0 })
  expect(await subscriptions(member.id)).toEqual([])
  await expectAccessible(page, 'import running, notify offered')
  await shot(page, 'notify-ask')

  await button.click()
  await expect(notify).toHaveAttribute('data-view', 'on')
  await expect(page.getByTestId('import.notify.on')).toContainText(en.import.notify.on)
  await expect(page.getByTestId('import.notify.say')).toHaveText(en.import.notify.say.on)
  expect(await asked(page)).toEqual({ asked: 1, subscribed: 1 })
  const saved = await subscriptions(member.id)
  expect(saved).toHaveLength(1)
  expect(saved[0]!.endpoint).toMatch(/^https:\/\/push\.example\.test\/send\//)
  await expectAccessible(page, 'import running, notify on')
  await shot(page, 'notify-on')

  // It is remembered: the page after a reload is still "on", and asks the browser nothing.
  await page.reload()
  await expect(page.getByTestId('import.notify')).toHaveAttribute('data-view', 'on')
  expect(await asked(page)).toEqual({ asked: 0, subscribed: 0 })

  await page.getByTestId('import.notify.disable').click()
  await expect(page.getByTestId('import.notify')).toHaveAttribute('data-view', 'ask')
  await expect(page.getByTestId('import.notify.say')).toHaveText(en.import.notify.say.off)
  await expect.poll(async () => (await subscriptions(member.id)).length).toBe(0)
})

test('where the browser says no, she is told so and has no button', async ({ page }) => {
  await pushBrowser(page, { answer: 'denied' })
  const member = await signedIn(page)
  await startImport(page)
  await page.getByTestId('import.notify.enable').click()
  await expect(page.getByTestId('import.notify')).toHaveAttribute('data-view', 'blocked')
  await expect(page.getByTestId('import.notify.blocked')).toHaveText(en.import.notify.blocked)
  await expect(page.getByTestId('import.notify.enable')).toHaveCount(0)
  expect(await subscriptions(member.id)).toEqual([])
  await expectAccessible(page, 'import running, notify blocked')
  await shot(page, 'notify-blocked')
})

test('in German, on a phone, the words fit', async ({ page }) => {
  await pushBrowser(page)
  await page.addInitScript(() => localStorage.setItem('libellus-locale', 'de'))
  await signedIn(page)
  await goto(page, '/import')
  await page.getByTestId('import.file').setInputFiles({ name: 'goodreads.csv', mimeType: 'text/csv', buffer: FILE })
  await expect(page.getByTestId('import.running')).toBeVisible()
  await expect(page.getByTestId('import.notify.enable')).toHaveText(de.import.notify.ask)
  // The longest of the locales' words, on the flows' phone: the page does not move sideways and no
  // element or word of it sticks out (e2e/support.ts, the design's own rule — docs/DESIGN.md), which
  // a literal box against a device's width (393 px, not 390) would not have caught.
  await expectNoSideScroll(page, 'import running, notify offered, German')
  await shot(page, 'notify-ask-de')
})

test('an iPhone in a Safari tab has no push there: she is told to add the app to her Home Screen, and nothing is asked', async ({ page }) => {
  await pushBrowser(page, { installed: false })
  await signedIn(page)
  await startImport(page)
  await expect(page.getByTestId('import.notify')).toHaveAttribute('data-view', 'install')
  await expect(page.getByTestId('import.notify.install')).toHaveText(en.import.notify.install)
  await expect(page.getByTestId('import.notify.enable')).toHaveCount(0)
  expect(await asked(page)).toEqual({ asked: 0, subscribed: 0 })
  await shot(page, 'notify-install')
})
