// Screenshots of the static mock-ups: node shoot.cjs [only]
//   PLAYWRIGHT=<path to a playwright package> when playwright is not installed beside this folder.
// Writes docs/images/book-detail/<name>.jpg at 2x, WebKit at iPhone size, in the dark room only: dark is
// the room these mocks are judged in (D's Night), and the owner asked for dark alone. The set is dark 390
// EN, dark 360 DE, plus every state panel of every variant at 390 EN. Any light shot left in the folder is
// stale; delete it rather than regenerate it.
const path = require('node:path')
const { webkit } = require(process.env.PLAYWRIGHT || 'playwright')
const FILES = ['v1', 'v2', 'v3']
const SHOTS = FILES.flatMap((file) => [
  [`${file}-dark-en`, `${file}.html`, 'dark', 'en', 390],
  [`${file}-dark-de-360`, `${file}.html`, 'dark', 'de', 360],
])
;(async () => {
  const only = process.argv[2]
  const browser = await webkit.launch()
  const out = path.resolve(__dirname, '../../images/book-detail')
  require('node:fs').mkdirSync(out, { recursive: true })
  for (const [name, file, theme, lang, w] of SHOTS) {
    if (only && !name.startsWith(only)) continue
    const h = w === 360 ? 780 : 844
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
    await page.goto(`file://${path.resolve(__dirname, file)}?theme=${theme}&lang=${lang}&w=${w}`)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    await page.locator('.phone').first().screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86 })
    // states A, B and F (and A2, the metadata block open): the panels a variant is judged on, 390 EN only
    if (w === 390 && lang === 'en') {
      const panels = page.locator('.phone')
      const n = await panels.count()
      for (let i = 0; i < n; i++) {
        const tag = await panels.nth(i).locator('.state-tag .k').innerText()
        const st = tag.replace('STATE ', '').toLowerCase()
        await panels.nth(i).screenshot({ path: path.join(out, `${file.replace('.html', '')}-${st}-${theme}-en.jpg`), type: 'jpeg', quality: 86 })
      }
    }
    await page.close()
    console.log('shot', name)
  }
  await browser.close()
})()
