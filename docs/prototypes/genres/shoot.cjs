// Screenshots of the static mock-ups: node shoot.cjs [only]   (PLAYWRIGHT=<path to a playwright package> if not installed here)
// Writes docs/images/genres/<name>.jpg at 2x, WebKit at iPhone size like web/scripts/readme-shots.ts.
const path = require('node:path')
const { webkit } = require(process.env.PLAYWRIGHT || 'playwright')
const SHOTS = [
  ['1-book-light-en', 'book.html', 'light', 'en', 390],
  ['1-book-dark-de', 'book.html', 'dark', 'de', 390],
  ['2-sheet-dark-en', 'sheet.html', 'dark', 'en', 390],
  ['2-sheet-light-de', 'sheet.html', 'light', 'de', 390],
  ['3-add-light-de', 'add.html', 'light', 'de', 390],
  ['3-add-dark-en', 'add.html', 'dark', 'en', 390],
  ['4-search-light-en-360', 'search.html', 'light', 'en', 360],
  ['4-search-dark-de-360', 'search.html', 'dark', 'de', 360],
  ['5-filter-dark-en', 'filter.html', 'dark', 'en', 390],
  ['5-filter-light-de', 'filter.html', 'light', 'de', 390],
  ['6-chart-light-en', 'chart.html', 'light', 'en', 390],
]
;(async () => {
  const only = process.argv[2]
  const browser = await webkit.launch()
  const out = path.resolve(__dirname, '../../images/genres')
  require('node:fs').mkdirSync(out, { recursive: true })
  for (const [name, file, theme, lang, w] of SHOTS) {
    if (only && !name.startsWith(only)) continue
    const h = w === 360 ? 780 : 844
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
    await page.goto(`file://${path.resolve(__dirname, file)}?theme=${theme}&lang=${lang}&w=${w}`)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    await page.locator('.phone').screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86 })
    await page.close()
    console.log('shot', name)
  }
  await browser.close()
})()
