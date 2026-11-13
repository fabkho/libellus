// Screenshots of the static mock-ups: node shoot.cjs [only]   (PLAYWRIGHT=<path to a playwright package> if not installed here;
// PW_WEBKIT=<path to pw_run.sh> for a WebKit build that is not the package's own revision)
// Writes docs/images/notes-composer/<name>.jpg at 2x, WebKit, the phone element only (embed=1 hides the page around it).
const path = require('node:path')
const fs = require('node:fs')
const { webkit } = require(process.env.PLAYWRIGHT || 'playwright')

// [name, version, query]
const S = (name, v, q) => [name, v, q]
const SHOTS = []
for (const v of [1, 2, 3]) {
  const p = `v${v}-`
  SHOTS.push(
    S(`${p}notes-rest-390-light-en`, v, 'ctx=notes&w=390&theme=light&lang=en'),
    S(`${p}notes-typing-390-dark-de`, v, 'ctx=notes&w=390&theme=dark&lang=de&kb=1&text=Ich%20glaube%2C%20die%20Karte%20ist'),
    S(`${p}notes-typing-360-light-en`, v, 'ctx=notes&w=360&theme=light&lang=en&kb=1&text=I%20think%20the%20map%20is'),
    S(`${p}notes-reply-360-dark-en`, v, 'ctx=notes&w=360&theme=dark&lang=en&kb=1&reply=1&text=Oh%21'),
    S(`${p}notes-everyone-390-light-en`, v, `ctx=notes&w=390&theme=light&lang=en&kb=1&level=public&text=Anyone%20else%20think%20the%20map%20is%20the%20narrator%3F${v === 3 ? '' : ''}`),
    S(`${p}notes-everyone-360-dark-de`, v, 'ctx=notes&w=360&theme=dark&lang=de&kb=1&level=public&spoiler=1&text=Denkt%20noch%20jemand%2C%20dass%20die%20Karte'),
    S(`${p}notes-onlyme-390-dark-en`, v, 'ctx=notes&w=390&theme=dark&lang=en&kb=1&level=private&text=Count%20the%20pears'),
    S(`${p}notes-big-360-light-de`, v, 'ctx=notes&w=360&theme=light&lang=de&big=1&level=public&text=Hallo'),
    S(`${p}notes-big-390-dark-en`, v, 'ctx=notes&w=390&theme=dark&lang=en&kb=1&big=1&level=public&text=Hello'),
    S(`${p}buddy-rest-390-light-en`, v, 'ctx=buddy&w=390&theme=light&lang=en'),
    S(`${p}buddy-typing-360-dark-de`, v, 'ctx=buddy&w=360&theme=dark&lang=de&kb=1&spoiler=1&text=Ich%20glaube%2C%20der%20Brunnen'),
    S(`${p}buddy-mic-390-dark-en`, v, 'ctx=buddy&w=390&theme=dark&lang=en&rec=1&spoiler=1'),
  )
}
// the menus of V2 and V3 open
SHOTS.push(
  S('v2-notes-menu-390-light-en', 2, 'ctx=notes&w=390&theme=light&lang=en&kb=1&menu=1&text=Oh%21'),
  S('v2-notes-menu-reply-360-dark-de', 2, 'ctx=notes&w=360&theme=dark&lang=de&kb=1&menu=1&reply=1&text=Oh%21'),
  S('v3-notes-menu-390-light-en', 3, 'ctx=notes&w=390&theme=light&lang=en&kb=1&menu=1&text=Oh%21&level=public'),
  S('v3-notes-menu-reply-360-dark-de', 3, 'ctx=notes&w=360&theme=dark&lang=de&kb=1&menu=1&reply=1&text=Oh%21'),
  S('v3-buddy-menu-390-dark-en', 3, 'ctx=buddy&w=390&theme=dark&lang=en&kb=1&menu=1&text=Oh%21'),
  // today's bug: the row folds with the keyboard, and stays folded after the keyboard went (Android back: closed, field still focused)
  S('v1-today-focus-390-light-en', 1, 'ctx=notes&w=390&theme=light&lang=en&kb=1&mode=today&text=Oh%21'),
  S('v1-today-stuck-390-light-en', 1, 'ctx=notes&w=390&theme=light&lang=en&back=1&mode=today&text=Oh%21'),
  S('v1-touch-targets-390-light-en', 1, 'ctx=notes&w=390&theme=light&lang=en&hits=1'),
  S('v2-touch-targets-390-light-en', 2, 'ctx=notes&w=390&theme=light&lang=en&hits=1'),
  S('v3-touch-targets-390-light-en', 3, 'ctx=notes&w=390&theme=light&lang=en&hits=1&text=Oh%21'),
)
;(async () => {
  const only = process.argv[2]
  const browser = await webkit.launch(process.env.PW_WEBKIT ? { executablePath: process.env.PW_WEBKIT } : {})
  const out = path.resolve(__dirname, '../../images/notes-composer')
  fs.mkdirSync(out, { recursive: true })
  for (const [name, v, q] of SHOTS) {
    if (only && !name.startsWith(only)) continue
    const w = /w=360/.test(q) ? 360 : 390
    const h = w === 360 ? 640 : 844
    const page = await browser.newPage({ viewport: { width: w + 40, height: h + 40 }, deviceScaleFactor: 2 })
    await page.goto(`file://${path.resolve(__dirname, `v${v}.html`)}?${q}&embed=1`)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(350)
    await page.locator('.phone').screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86 })
    await page.close()
    console.log('shot', name)
  }
  // the comparison page (three live phones side by side)
  for (const [name, q, w, h] of [['00-compare-notes-390-light-en', 'ctx=notes&w=390&theme=light&lang=en', 1320, 1150], ['00-compare-buddy-360-dark-de', 'ctx=buddy&w=360&theme=dark&lang=de', 1240, 940]]) {
    if (only && !name.startsWith(only)) continue
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1.5 })
    await page.goto(`file://${path.resolve(__dirname, 'index.html')}?${q}`)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(900)
    await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 84, fullPage: true })
    await page.close()
    console.log('shot', name)
  }
  await browser.close()
})()
