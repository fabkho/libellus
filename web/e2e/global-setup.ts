import { webkit, type FullConfig } from '@playwright/test'

/**
 * Wakes the dev server before the first test. `nuxt dev` compiles each route
 * and pre-bundles its dependencies on first request, and on a cold CI runner
 * that can take long enough, or reload the page under a test, for the first
 * flows to time out. Visiting every screen once here moves that cost out of
 * the tests. A failure only skips the warm-up: the tests then say what is wrong.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!
  const browser = await webkit.launch()
  try {
    const page = await browser.newPage()
    for (const path of ['/sign-in', '/sign-up', '/verify', '/']) {
      await page.goto(`${baseURL}${path}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
    }
  } finally {
    await browser.close()
  }
}
