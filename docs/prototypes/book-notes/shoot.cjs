// Screenshots of the static mock-ups: node shoot.cjs [only]   (PLAYWRIGHT=<path to a playwright package> if not installed here)
// Writes docs/images/book-notes/<name>.jpg at 2x, WebKit at iPhone size like web/scripts/readme-shots.ts.
const path = require('node:path')
const { webkit } = require(process.env.PLAYWRIGHT || 'playwright')
const SHOTS = [
  ['1-book-friend-light-en', 'book.html', 'light', 'en', 390],
  ['1-book-friend-dark-de', 'book.html', 'dark', 'de', 390],
  ['2-start-light-en', 'start.html', 'light', 'en', 390],
  ['2-start-dark-de', 'start.html', 'dark', 'de', 390],
  ['3-room-dark-en', 'room.html', 'dark', 'en', 390],
  ['3-room-light-de-360', 'room.html', 'light', 'de', 360],
  ['4-thread-light-en', 'thread.html', 'light', 'en', 390],
  ['4-thread-dark-de', 'thread.html', 'dark', 'de', 390],
  ['5-join-dark-en', 'join.html', 'dark', 'en', 390],
  ['5-join-light-de', 'join.html', 'light', 'de', 390],
  ['6-profile-light-en', 'profile.html', 'light', 'en', 390],
  ['6-profile-dark-de', 'profile.html', 'dark', 'de', 390],
  ['7-empty-dark-en', 'empty.html', 'dark', 'en', 390],
  ['7-empty-light-de', 'empty.html', 'light', 'de', 390],
  // Appendix B (all members, later): kept for that phase only.
  ['later-1-first-use-light-en', 'later-first-use.html', 'light', 'en', 390],
  ['later-2-member-dark-en', 'later-member.html', 'dark', 'en', 390],
  ['later-3-report-light-de', 'later-report.html', 'light', 'de', 390],
]
;(async () => {
  const only = process.argv[2]
  const browser = await webkit.launch()
  const out = path.resolve(__dirname, '../../images/book-notes')
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
