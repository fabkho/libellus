// Screenshots of the Home reading card mock-ups: node shoot.cjs [only]
//   PLAYWRIGHT=<path to a playwright package> if the one here is not installed
// Writes docs/images/home-card/<variant>-<state>-<theme>.jpg at 2x, WebKit at iPhone size. Every panel
// of every file is shot in both themes: six states (a mid-read page-based, b percent only, c just
// started, d the last page, e the +24 gain, f German at 360 px) and l (the same card on the Library).
// State F is German in either theme: it is the 360 px proof, and German is longer than English.
const path = require('node:path')
const fs = require('node:fs')
const { webkit } = require(process.env.PLAYWRIGHT || 'playwright')
const VARIANTS = ['v1-lean', 'v2-hierarchy', 'v3-restructured']
const THEMES = ['light', 'dark']
;(async () => {
  const only = process.argv[2]
  const browser = await webkit.launch()
  const out = path.resolve(__dirname, '../../images/home-card')
  fs.mkdirSync(out, { recursive: true })
  for (const variant of VARIANTS) {
    if (only && !variant.startsWith(only)) continue
    for (const theme of THEMES) {
      const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 })
      await page.goto(`file://${path.resolve(__dirname, `${variant}.html`)}?theme=${theme}&lang=en`)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(400)
      const panels = page.locator('.phone')
      const count = await panels.count()
      for (let i = 0; i < count; i++) {
        const panel = panels.nth(i)
        const tag = await panel.locator('.state-tag .k').innerText()
        const state = tag.replace('STATE ', '').toLowerCase()
        await panel.screenshot({ path: path.join(out, `${variant}-${state}-${theme}.jpg`), type: 'jpeg', quality: 88 })
      }
      console.log('shot', variant, theme, count, 'panels')
      await page.close()
    }
  }
  await browser.close()
})()
