// Screenshots of the static mock-ups: node shoot.cjs [only]   (PLAYWRIGHT=<path to a playwright package> if not installed here)
// Writes docs/images/book-actions/<name>.jpg at 2x, WebKit at iPhone size. One shot per variant x
// {light 390 EN, dark 390 EN, light 360 DE, dark 360 DE}: the DE 360 shot is where a three-across row breaks.
const path = require('node:path')
const { webkit } = require(process.env.PLAYWRIGHT || 'playwright')
const SHOTS = [
  ['v1-light-en', 'v1.html', 'light', 'en', 390],
  ['v1-dark-en', 'v1.html', 'dark', 'en', 390],
  ['v1-light-de-360', 'v1.html', 'light', 'de', 360],
  ['v1-dark-de-360', 'v1.html', 'dark', 'de', 360],
  ['v2-light-en', 'v2.html', 'light', 'en', 390],
  ['v2-dark-en', 'v2.html', 'dark', 'en', 390],
  ['v2-light-de-360', 'v2.html', 'light', 'de', 360],
  ['v2-dark-de-360', 'v2.html', 'dark', 'de', 360],
  ['v3-light-en', 'v3.html', 'light', 'en', 390],
  ['v3-dark-en', 'v3.html', 'dark', 'en', 390],
  ['v3-light-de-360', 'v3.html', 'light', 'de', 360],
  ['v3-dark-de-360', 'v3.html', 'dark', 'de', 360],
  ['v4-light-en', 'v4.html', 'light', 'en', 390],
  ['v4-dark-en', 'v4.html', 'dark', 'en', 390],
  ['v4-light-de-360', 'v4.html', 'light', 'de', 360],
  ['v4-dark-de-360', 'v4.html', 'dark', 'de', 360],
]
;(async () => {
  const only = process.argv[2]
  const browser = await webkit.launch()
  const out = path.resolve(__dirname, '../../images/book-actions')
  require('node:fs').mkdirSync(out, { recursive: true })
  for (const [name, file, theme, lang, w] of SHOTS) {
    if (only && !name.startsWith(only)) continue
    const h = w === 360 ? 780 : 844
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
    await page.goto(`file://${path.resolve(__dirname, file)}?theme=${theme}&lang=${lang}&w=${w}`)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    await page.locator('.phone').first().screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86 })
    // states B–E: the busy state D must be judged too — shoot every state panel, EN light 390 only
    if (theme === 'light' && lang === 'en') {
      const panels = page.locator('.phone')
      const n = await panels.count()
      for (let i = 0; i < n; i++) {
        const tag = await panels.nth(i).locator('.state-tag .k').innerText()
        const st = tag.replace('STATE ', '').toLowerCase()
        await panels.nth(i).screenshot({ path: path.join(out, `${file.replace('.html', '')}-${st}-light-en.jpg`), type: 'jpeg', quality: 86 })
      }
    }
    await page.close()
    console.log('shot', name)
  }
  await browser.close()
})()
