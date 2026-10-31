// The motion of the chosen mark (option 6, Lamp over the page): animated SVGs, recordings and a
// demo page, written to design/logo-options/6-lamp-over-page/motion/. Run build.mjs first (this
// reads the placement of the mark from its icon.svg); dependencies as in build.mjs, plus ffmpeg:
//
//   LOGO_DEPS=/tmp/brlogo [CHROMIUM=…] node design/logo-options/animate.mjs
//
// The motion uses the motion tokens only (docs/MOTION.md): the pages arrive over `gentle` on the
// `standard` curve, the lamp rises over `wave` on `standard` (fast out of the gate, a long soft
// landing), and its glow swells over `wave` on the `wave` curve. Every animation ends on the static
// icon, and with Reduce Motion nothing moves: the SVG shows its last frame at once.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPTIONS, THEMES } from './marks.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const deps = process.env.LOGO_DEPS ?? '/tmp/brlogo'
const require = createRequire(join(deps, 'package.json'))
const { chromium } = require('playwright')
const tokens = JSON.parse(readFileSync(join(here, '../tokens.json'), 'utf8'))

const o = OPTIONS.find((x) => x.n === 6)
const dir = join(here, o.slug, 'motion')
mkdirSync(dir, { recursive: true })

const ms = (name) => tokens.duration[name].$value
const curve = (name) => `cubic-bezier(${tokens.easing[name].$value.join(',')})`
const T = { gentle: ms('gentle'), wave: ms('wave'), standard: ms('standard'), exit: ms('exit') }

// ------------------------------------------------------------------ the parts, placed as in icon.svg

const icon = readFileSync(join(here, o.slug, 'icon.svg'), 'utf8')
const place = /<g transform="(translate\([^)]*\) scale\([^)]*\))">/.exec(icon)[1]
const glow = /<radialGradient id="o6agl" cx="([\d.]+)" cy="([\d.]+)"/.exec(icon)
const [pages, sun] = o.parts('full')

const style = `
.pages{animation:br-pages ${T.gentle}ms ${curve('standard')} both}
.sun{animation:br-sun ${T.wave}ms ${curve('standard')} 150ms both}
.glow{animation:br-glow ${T.wave}ms ${curve('wave')} 300ms both}
@keyframes br-pages{from{opacity:0;transform:translateY(6px)}}
@keyframes br-sun{from{transform:translateY(34px)}}
@keyframes br-glow{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.pages,.sun,.glow{animation:none}}`

/** The animated app icon: the room, the lamp's glow, the pages arriving, the lamp rising behind them. */
function iconAnimated() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="108" height="108">
<title>BetterReads — Lamp over the page, animated (the lamp rises behind the pages; ends on the static icon)</title>
<style>${style}</style>
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="108" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${o.room.top}"/><stop offset="1" stop-color="${o.room.bottom}"/></linearGradient><radialGradient id="gl" cx="${glow[1]}" cy="${glow[2]}" r="54" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#efb768" stop-opacity="0.4"/><stop offset="0.4" stop-color="#efb768" stop-opacity="0.14"/><stop offset="1" stop-color="#efb768" stop-opacity="0"/></radialGradient><clipPath id="sky"><path d="${sun.clip}"/></clipPath></defs>
<rect width="108" height="108" fill="url(#bg)"/><rect class="glow" width="108" height="108" fill="url(#gl)"/>
<g transform="${place}"><g clip-path="url(#sky)"><path class="sun" fill="${o.icon.accent}" d="${sun.d}"/></g><path class="pages" fill="${o.icon.main}" d="${pages.d}"/></g>
</svg>
`
}

/** The bare mark, animated, for a page in the light or the dark theme (the way in, a launch screen). */
function markAnimated(theme) {
  const t = THEMES[theme]
  const halo =
    theme === 'dark'
      ? `<radialGradient id="gl" cx="50" cy="50" r="46" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#efb768" stop-opacity="0.3"/><stop offset="0.45" stop-color="#efb768" stop-opacity="0.09"/><stop offset="1" stop-color="#efb768" stop-opacity="0"/></radialGradient>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 22 88 72" width="88" height="72">
<title>BetterReads — Lamp over the page, the mark animated for the ${theme} theme</title>
<style>${style}</style>
<defs>${halo}<clipPath id="sky"><path d="${sun.clip}"/></clipPath></defs>
${theme === 'dark' ? '<rect class="glow" x="6" y="22" width="88" height="72" fill="url(#gl)"/>' : ''}<g clip-path="url(#sky)"><path class="sun" fill="${t.accent}" d="${sun.d}"/></g><path class="pages" fill="${t.main}" d="${pages.d}"/>
</svg>
`
}

const files = {
  'icon-animated.svg': iconAnimated(),
  'mark-animated-dark.svg': markAnimated('dark'),
  'mark-animated-light.svg': markAnimated('light'),
}
for (const [name, svg] of Object.entries(files)) writeFileSync(join(dir, name), svg)

// ------------------------------------------------------------------ the handover demo (a timeline)

// One function of time draws the whole Android sequence, so the page can play it live and the
// recorder can step it frame by frame. Times in ms.
const H = { splash: 1000, swell: T.wave, fade: T.standard, hold: 1400 }
H.total = H.splash + H.swell + H.fade + H.hold

const homeDark = `data:image/jpeg;base64,${readFileSync(join(here, '../../docs/images/home-dark.jpg')).toString('base64')}`
// iOS's continuous-corner squircle, as a superellipse (n = 5) in objectBoundingBox units (as in build.mjs).
const SQUIRCLE = (() => {
  const pts = []
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    pts.push([0.5 + 0.5 * Math.sign(c) * Math.abs(c) ** 0.4, 0.5 + 0.5 * Math.sign(s) * Math.abs(s) ** 0.4])
  }
  return 'M' + pts.map(([x, y]) => `${x.toFixed(4)} ${y.toFixed(4)}`).join('L') + 'Z'
})()
const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// the phone's screen: the night room (manifest background_color), the icon as Android 12+ shows it
// (the adaptive icon in a circle), a glow the page adds, and the app underneath.
const phone = (id) => `<div class="phone" id="${id}">
  <div class="screen">
    <img class="app" src="${homeDark}" alt="BetterReads, Home">
    <div class="splash"><div class="halo"></div><div class="circle"><img src="${uri(icon)}" alt=""></div></div>
  </div>
</div>`

const timeline = `
const bez=(x1,y1,x2,y2)=>t=>{if(t<=0)return 0;if(t>=1)return 1;let a=0,b=1,x;for(let i=0;i<30;i++){x=(a+b)/2;const cx=3*x*(1-x)*(1-x)*x1+3*x*x*(1-x)*x2+x*x*x;if(cx<t)a=x;else b=x}x=(a+b)/2;return 3*x*(1-x)*(1-x)*y1+3*x*x*(1-x)*y2+x*x*x};
const E={standard:bez(${tokens.easing.standard.$value}),wave:bez(${tokens.easing.wave.$value}),exit:bez(${tokens.easing.exit.$value})};
const H=${JSON.stringify(H)};
const clamp=(v)=>Math.min(1,Math.max(0,v));
function draw(root,t,steps){
  const s=root.querySelector('.splash'),halo=root.querySelector('.halo'),app=root.querySelector('.app');
  const swell=E.wave(clamp((t-H.splash)/H.swell));
  const out=clamp((t-H.splash-H.swell)/H.fade);
  halo.style.opacity=swell;
  halo.style.transform='scale('+(0.6+0.4*swell)+')';
  s.style.opacity=1-E.exit(clamp((t-H.splash-H.swell)/${T.exit}));
  app.style.opacity=E.standard(out);
  if(steps){const k=t<H.splash?0:t<H.splash+H.swell?1:2;steps.forEach((el,i)=>el.classList.toggle('on',i===k))}
}`

const PAGE_CSS = (fontCss) => `${fontCss}
:root{--surface:#f4f0e9;--raised:#fbf9f5;--ink:#1c1915;--muted:rgb(28 25 21 / .74);--faint:rgb(28 25 21 / .62);--hair:rgb(28 25 21 / .1);--accent:#845418}
[data-theme=dark]{--surface:#0e0c0a;--raised:#171512;--ink:#eee7dc;--muted:rgb(238 231 220 / .74);--faint:rgb(238 231 220 / .56);--hair:rgb(238 231 220 / .085);--accent:#efb768}
*{box-sizing:border-box}html{background:var(--surface);color:var(--ink);font-family:Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.phone{width:300px;height:640px;border-radius:44px;padding:9px;background:#111;box-shadow:0 0 0 1px #444,0 30px 60px -24px rgb(0 0 0 / .5);flex:none}
.screen{position:relative;width:100%;height:100%;border-radius:36px;overflow:hidden;background:${THEMES.dark.surface}}
.app{position:absolute;left:0;top:26px;width:100%;height:auto;opacity:0}
.splash{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.circle{position:relative;width:112px;height:112px;border-radius:50%;overflow:hidden}
.circle img{position:absolute;width:168px;height:168px;left:-28px;top:-28px}
.halo{position:absolute;width:420px;height:420px;border-radius:50%;background:radial-gradient(closest-side,rgb(239 183 104 / .34),rgb(239 183 104 / .1) 45%,rgb(239 183 104 / 0));opacity:0}
`

const fontFile = (family, weight, style) => join(deps, 'node_modules/@fontsource', family, 'files', `${family}-latin-${weight}-${style}.woff2`)
const FONT_CSS = [
  ['Geist', 'geist-sans', 400, 'normal'],
  ['Geist', 'geist-sans', 500, 'normal'],
  ['Geist Mono', 'geist-mono', 400, 'normal'],
  ['Newsreader', 'newsreader', 500, 'normal'],
  ['Newsreader', 'newsreader', 400, 'italic'],
]
  .map(([n, fam, w, st]) => `@font-face{font-family:'${n}';font-weight:${w};font-style:${st};src:url(data:font/woff2;base64,${readFileSync(fontFile(fam, w, st)).toString('base64')}) format('woff2')}`)
  .join('\n')

// ------------------------------------------------------------------ the page (shared as an Orca artifact)

function page() {
  const rows = [
    ['The pages arrive', `opacity and 6 units of rise over <code>gentle</code> (${T.gentle} ms), <code>standard</code> curve`],
    ['The lamp rises behind them', `from below the pages' edge to its place over <code>wave</code> (${T.wave} ms), <code>standard</code> curve, 150 ms in`],
    ['Its glow swells', `opacity over <code>wave</code> (${T.wave} ms), <code>wave</code> curve, 300 ms in`],
    ['Reduce Motion', 'no animation: the last frame (the static icon) at once'],
  ]
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BetterReads · the mark in motion</title>
<style>${PAGE_CSS(FONT_CSS)}
body{margin:0 auto;padding:48px clamp(16px,4vw,56px) 64px;max-width:1240px}
.eyebrow{font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
h1{font-family:Newsreader,serif;font-weight:500;font-size:clamp(34px,5vw,52px);letter-spacing:-.02em;margin:6px 0 0}
h2{font-family:Newsreader,serif;font-weight:500;font-size:28px;letter-spacing:-.01em;margin:0 0 6px}
p{line-height:1.6;color:var(--muted);font-size:15.5px;max-width:760px}
code{font-family:'Geist Mono',monospace;font-size:.88em}
section{margin-top:52px}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap}
button{font:inherit;font-size:13px;color:var(--ink);background:var(--raised);border:0;box-shadow:0 0 0 1px var(--hair);border-radius:999px;padding:8px 14px;cursor:pointer}
.stage{display:flex;gap:22px;flex-wrap:wrap;align-items:stretch;margin-top:20px}
.tile{background:var(--raised);border-radius:22px;box-shadow:0 0 0 .5px var(--hair);padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;min-width:250px;flex:1}
.tile.dark{background:${THEMES.dark.surface}}.tile.light{background:${THEMES.light.surface}}
.cap{font-family:'Geist Mono',monospace;font-size:11px;color:var(--faint)}.tile.dark .cap{color:${THEMES.dark.faint}}.tile.light .cap{color:${THEMES.light.faint}}
.squircle{clip-path:url(#squircle)}
.wm{font-family:Newsreader,serif;font-style:italic;font-size:40px;letter-spacing:-.02em;opacity:0;animation:wm ${T.gentle}ms ${curve('standard')} 900ms both}
.tile.dark .wm{color:${THEMES.dark.text}}.tile.light .wm{color:${THEMES.light.text}}
@keyframes wm{from{opacity:0;transform:translateY(4px)}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.wm{animation:none;opacity:1}}
.android{display:flex;gap:36px;align-items:center;flex-wrap:wrap;margin-top:20px}
.steps{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px;max-width:520px}
.steps li{padding:14px 16px;border-radius:14px;background:var(--raised);box-shadow:0 0 0 .5px var(--hair);color:var(--muted);font-size:14.5px;line-height:1.5;transition:box-shadow ${T.standard}ms}
.steps li b{color:var(--ink);font-weight:500}.steps li.on{box-shadow:0 0 0 1.5px var(--accent)}
table{border-collapse:collapse;margin-top:12px;font-size:14px}td{padding:9px 16px 9px 0;border-top:1px solid var(--hair);color:var(--muted);vertical-align:top}td:first-child{color:var(--ink);white-space:nowrap}
.answer{background:var(--raised);border-radius:22px;padding:24px 26px;box-shadow:0 0 0 .5px var(--hair);margin-top:18px}
.answer p{margin:10px 0 0}.answer p:first-child{margin-top:0}
ul.notes{color:var(--muted);line-height:1.6;font-size:15px;max-width:780px;padding-left:20px}
</style></head><body>
<svg width="0" height="0" style="position:absolute"><clipPath id="squircle" clipPathUnits="objectBoundingBox"><path d="${SQUIRCLE}"/></clipPath></svg>
<div class="top"><div><div class="eyebrow">BetterReads · option 6, Lamp over the page</div><h1>The mark in motion</h1></div><div style="display:flex;gap:10px"><button id="replay" type="button">Replay</button><button id="theme" type="button">Dark page</button></div></div>
<p>The lamp rises behind the open book and its light fills the room, then everything rests on the static icon. It is one quiet movement, about a second and a half, made only of the motion tokens, and it is an SVG of a few kilobytes that plays by itself wherever an image can go.</p>

<section><h2>The animation</h2>
<div class="stage" id="reveal">
  <div class="tile"><img class="squircle" src="${uri(files['icon-animated.svg'])}" width="220" height="220" alt="The icon, animated"><div class="cap">icon-animated.svg · the app icon</div></div>
  <div class="tile dark"><img src="${uri(files['mark-animated-dark.svg'])}" width="200" alt="The mark, dark"><div class="wm">betterreads</div><div class="cap">mark-animated-dark.svg · the way in, dark</div></div>
  <div class="tile light"><img src="${uri(files['mark-animated-light.svg'])}" width="200" alt="The mark, light"><div class="wm">betterreads</div><div class="cap">mark-animated-light.svg · the way in, light</div></div>
</div>
<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
</section>

<section><h2>Can Android's launch screen animate?</h2>
<div class="answer">
<p><b>Not the screen Android draws, no.</b> When an installed PWA starts, Android (and Chrome, for its WebAPK) draws the launch screen itself from the manifest: <code>background_color</code>, one of the manifest's icons and, before Android 12, the name. It is a static picture and the manifest has no field for motion. The animated launch icons Android 12 offers (an animated vector drawable in the SplashScreen API) are for native apps that ship that resource; a WebAPK cannot, and an animated SVG icon is turned into a still bitmap when the app is installed.</p>
<p><b>But the page can take over from it.</b> The first thing the app paints can be the same picture: the night room (BetterReads' manifest already uses <code>surface.dark</code>, #0e0c0a) with the icon in the same place. To the eye the static splash simply comes alive, then gives way to the app. That is what the phone below plays.</p>
</div>
<div class="android">
  ${phone('handover')}
  <ol class="steps" id="steps">
    <li><b>1 · Android's launch screen.</b> Static, drawn by the system from the manifest: the night room and the icon in a circle. Nothing here can move.</li>
    <li><b>2 · The app's first paint, the same frame.</b> The page draws the identical picture (inline in index.html, no JavaScript needed), so the handover is invisible, and the lamp's light swells out of the icon into the room over <code>wave</code>.</li>
    <li><b>3 · The app.</b> The launch picture leaves over <code>exit</code> and the app fades in over <code>standard</code>. It never waits for the animation: if the app is ready sooner, it cuts the swell short.</li>
  </ol>
</div>
<ul class="notes">
  <li>Only on a cold start of the installed app (<code>display-mode: standalone</code>), not on every navigation or in the browser.</li>
  <li>With Reduce Motion it is a plain crossfade from the launch picture to the app.</li>
  <li>The icon's size and place on Android's splash differ by Android version and maker (a circle in the middle since Android 12, the icon and the name before), so the takeover has to be measured on a real phone and tuned to Android 12+; on older ones it can only come close.</li>
  <li>The full rise (the lamp coming up from behind the pages) belongs where nothing is waiting: the sign-in screen ("the way in", above the wordmark) and the README hero. On the launch screen the lamp is already up, because Android drew it that way.</li>
</ul>
</section>
<script>
${timeline}
const root=document.getElementById('handover'),steps=[...document.querySelectorAll('#steps li')];
let t0=performance.now();
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
(function loop(now){const t=(now-t0)%H.total;draw(root,reduce?(t<H.splash?0:H.total):t,steps);requestAnimationFrame(loop)})(t0);
document.getElementById('replay').onclick=()=>{t0=performance.now();document.querySelectorAll('#reveal img, #reveal .wm').forEach(el=>{if(el.tagName==='IMG'){const s=el.src;el.src='';el.src=s}else{el.style.animation='none';el.offsetWidth;el.style.animation=''}})};
const b=document.getElementById('theme');const set=(d)=>{document.documentElement.dataset.theme=d?'dark':'light';b.textContent=d?'Light page':'Dark page'};
set(matchMedia('(prefers-color-scheme: dark)').matches);b.onclick=()=>set(document.documentElement.dataset.theme!=='dark');
</script>
</body></html>
`
}
writeFileSync(join(dir, 'index.html'), page())

// ------------------------------------------------------------------ recordings (frame by frame, then ffmpeg)

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const tab = await browser.newPage({ deviceScaleFactor: 2 })
const FPS = 30
const tmp = join(dir, '.frames')

async function record(name, html, width, height, duration, step) {
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp)
  await tab.setViewportSize({ width, height })
  await tab.setContent(html, { waitUntil: 'load' })
  await tab.evaluate(() => document.fonts.ready)
  const n = Math.round((duration / 1000) * FPS)
  for (let i = 0; i <= n; i++) {
    await step((i * 1000) / FPS)
    await tab.screenshot({ path: join(tmp, `f${String(i).padStart(4, '0')}.png`) })
  }
  const input = ['-y', '-framerate', String(FPS), '-i', join(tmp, 'f%04d.png')]
  execFileSync('ffmpeg', [...input, '-vf', `scale=${width}:-2:flags=lanczos`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', join(dir, `${name}.mp4`)], { stdio: 'ignore' })
  execFileSync('ffmpeg', [...input, '-vf', `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192[p];[b][p]paletteuse=dither=sierra2_4a`, join(dir, `${name}.gif`)], { stdio: 'ignore' })
  rmSync(tmp, { recursive: true, force: true })
}

// The reveal: the icon and the two marks side by side, the SVG animations paused and stepped.
const inline = (svg, w) => svg.replace(/<svg /, `<svg style="width:${w}px;height:auto;display:block" `).replace(/<title>[^<]*<\/title>/, '')
const scoped = (svg, p, w) => inline(svg, w).replace(/id="(\w+)"/g, `id="${p}$1"`).replace(/url\(#(\w+)\)/g, `url(#${p}$1)`).replace(/br-(pages|sun|glow)/g, `${p}br-$1`).replace(/\.(pages|sun|glow)\{/g, `.${p}$1{`).replace(/class="(pages|sun|glow)"/g, `class="${p}$1"`).replace(/\.pages,\.sun,\.glow/, `.${p}pages,.${p}sun,.${p}glow`)
const revealHtml = `<!doctype html><html><head><style>${FONT_CSS}
html,body{margin:0;background:#e9e4da;font-family:Geist,sans-serif}
.row{display:flex;gap:16px;padding:20px;width:960px;height:360px;box-sizing:border-box}
.t{flex:1;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.t.i{background:#fbf9f5}.t.d{background:${THEMES.dark.surface}}.t.l{background:${THEMES.light.surface}}
.sq{clip-path:url(#squircle);width:220px;height:220px}
.wm{font-family:Newsreader,serif;font-style:italic;font-size:30px;letter-spacing:-.02em;opacity:0}
.t.d .wm{color:${THEMES.dark.text}}.t.l .wm{color:${THEMES.light.text}}
</style></head><body>
<svg width="0" height="0" style="position:absolute"><clipPath id="squircle" clipPathUnits="objectBoundingBox"><path d="${SQUIRCLE}"/></clipPath></svg>
<div class="row"><div class="t i"><div class="sq">${scoped(files['icon-animated.svg'], 'a', 220)}</div></div>
<div class="t d">${scoped(files['mark-animated-dark.svg'], 'b', 200)}<div class="wm">betterreads</div></div>
<div class="t l">${scoped(files['mark-animated-light.svg'], 'c', 200)}<div class="wm">betterreads</div></div></div>
</body></html>`
const revealLength = 150 + T.wave + 700
await record('reveal', revealHtml, 960, 360, revealLength, async (t) => {
  await tab.evaluate(
    ({ t, gentle }) => {
      for (const a of document.getAnimations()) {
        a.pause()
        a.currentTime = t
      }
      // the wordmark follows the mark: it arrives over `gentle`, 900 ms in
      const k = Math.min(1, Math.max(0, (t - 900) / gentle))
      const e = 1 - Math.pow(1 - k, 3)
      for (const w of document.querySelectorAll('.wm')) {
        w.style.opacity = e
        w.style.transform = `translateY(${4 * (1 - e)}px)`
      }
    },
    { t, gentle: T.gentle },
  )
})

// The Android handover, from the same timeline as the page.
const handoverHtml = `<!doctype html><html><head><style>${PAGE_CSS('')}html,body{margin:0;background:#e9e4da}.w{padding:20px 30px;width:360px}</style></head><body><div class="w">${phone('p')}</div><script>${timeline}</script></body></html>`
await record('handover', handoverHtml, 360, 680, H.total, async (t) => {
  await tab.evaluate((t) => draw(document.getElementById('p'), t, null), t)
})

await browser.close()
console.log('written:', Object.keys(files).join(', '), '+ index.html, reveal.{mp4,gif}, handover.{mp4,gif}')
