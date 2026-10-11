// The shell every Libellus email shares: page, wordmark, card, footer, the colours and the dark-mode
// block. An email (magic_link.mjs) only says what goes into the card; this file decides how it looks.
//
// Mail clients are not browsers: Gmail strips or ignores <style> in places, Outlook's Word engine
// ignores most CSS, web fonts do not load. So the layout is tables, every colour and size is inlined
// from design/tokens.json, and the one <style> block only adds the dark scheme for the clients that
// read it (Apple Mail, iOS Mail, Outlook for Mac, Gmail's apps in part, Outlook.com via [data-ogs*]).
// Light is the inlined default. Nothing is fetched: no images, no fonts, no tracking.
//
// Colours come from the tokens' `light` and `dark` values (the app's two rooms), flattened onto the
// surface they sit on, since `rgb(… / 0.74)` is not safe in mail. Every text colour is checked for
// 4.5:1 against its surface at build time (docs/ACCESSIBILITY.md holds the app to the same).
import { contrast, flatten } from './color.mjs'

const SCHEMES = ['light', 'dark']
const px = (n) => `${Number(n.toFixed(2))}px`

/**
 * Mail has no web fonts, so each token stack gets safe system fallbacks inserted before its generic
 * family: whoever has Geist/Newsreader installed sees them, everyone else the nearest system face.
 */
const FALLBACKS = {
  sans: ['BlinkMacSystemFont', "'Segoe UI'", 'Roboto', 'Helvetica', 'Arial'],
  mono: ["'SF Mono'", 'SFMono-Regular', 'Menlo', 'Consolas', "'Liberation Mono'", "'Courier New'"],
  serif: ["'Times New Roman'"],
}
const quote = (name) => (/\s/.test(name) && !/^['"]/.test(name) ? `'${name}'` : name)

/** What a text colour role sits on, for the contrast check. */
const TEXT_ON = { ink: 'card', muted: 'card', faint: 'card', 'muted-page': 'page', 'faint-page': 'page' }

export function createKit(tokens) {
  const themed = (token, scheme) => {
    const v = token.$value
    return v && typeof v === 'object' && 'light' in v ? v[scheme] : v
  }
  const color = (name, scheme) => themed(tokens.color[name], scheme)

  // ---- palette: one set of plain hex colours per scheme
  const palette = Object.fromEntries(
    SCHEMES.map((scheme) => {
      const page = color('surface', scheme)
      const card = color('surfaceRaised', scheme)
      return [
        scheme,
        {
          page,
          card,
          fill: flatten(color('fill', scheme), card),
          hair: flatten(color('hairline', scheme), card),
          ink: color('ink', scheme),
          muted: flatten(color('inkMuted', scheme), card),
          faint: flatten(color('inkFaint', scheme), card),
          'muted-page': flatten(color('inkMuted', scheme), page),
          'faint-page': flatten(color('inkFaint', scheme), page),
          accent: color('accent', scheme),
          'on-ink': color('onInk', scheme),
        },
      ]
    }),
  )

  for (const scheme of SCHEMES) {
    for (const [role, surface] of Object.entries(TEXT_ON)) {
      const ratio = contrast(palette[scheme][role], palette[scheme][surface])
      if (ratio < 4.5) throw new Error(`Email text "${role}" on "${surface}" is ${ratio.toFixed(2)}:1 in ${scheme}; it needs 4.5:1.`)
    }
    // The code is read off the lamp-tinted fill, not the card.
    const onFill = contrast(palette[scheme].ink, palette[scheme].fill)
    if (onFill < 4.5) throw new Error(`Email code on its fill is ${onFill.toFixed(2)}:1 in ${scheme}; it needs 4.5:1.`)
    // The button's label is read off the ink fill (the app's primary button).
    const onInk = contrast(palette[scheme]['on-ink'], palette[scheme].ink)
    if (onInk < 4.5) throw new Error(`Email button label on ink is ${onInk.toFixed(2)}:1 in ${scheme}; it needs 4.5:1.`)
  }

  // ---- paint: a class carries one colour role; the light value is inlined, the dark one is in <style>
    const PAINT = {
    'bg-page': ['background-color', 'page'],
    'bg-card': ['background-color', 'card'],
    'bg-fill': ['background-color', 'fill'],
    'bc-hair': ['border-color', 'hair'],
    'bg-accent': ['background-color', 'accent'],
    'bg-ink': ['background-color', 'ink'],
    'c-ink': ['color', 'ink'],
    'c-on-ink': ['color', 'on-ink'],
    'c-muted': ['color', 'muted'],
    'c-faint': ['color', 'faint'],
    'c-muted-page': ['color', 'muted-page'],
    'c-faint-page': ['color', 'faint-page'],
  }
  const used = new Set()

  /** `class="…" style="…"` for an element: the paint classes' light values, then `style`. */
  const x = (classes = '', style = '') => {
    const names = classes.split(/\s+/).filter(Boolean)
    for (const name of names) {
      if (!PAINT[name]) throw new Error(`Unknown paint class "${name}".`)
      used.add(name)
    }
    const paint = names.map((name) => `${PAINT[name][0]}:${palette.light[PAINT[name][1]]}`)
    const css = [style.replace(/;$/, ''), ...paint].filter(Boolean).join(';')
    return `${names.length ? `class="${names.join(' ')}" ` : ''}style="${css}"`
  }

  // ---- type: sizes, line heights and tracking from the token scale, as px (Outlook reads px best)
  const families = Object.fromEntries(
    ['sans', 'mono', 'serif'].map((key) => {
      const list = tokens.fontFamily[key].$value.map(quote)
      const generic = list.pop()
      return [key, [...list, ...FALLBACKS[key], generic].join(',')]
    }),
  )
  /** `font-…` CSS for a step of the type scale in one family. */
  const type = (step, family = 'sans', override = {}) => {
    const t = { ...tokens.text[step].$value, ...override }
    const parts = [
      `font-family:${families[family]}`,
      `font-size:${px(t.fontSize)}`,
      `line-height:${px(t.lineHeight)}`,
      `font-weight:${t.fontWeight ?? 400}`,
    ]
    if (t.letterSpacing) parts.push(`letter-spacing:${px(t.letterSpacing * t.fontSize)}`)
    return parts.join(';')
  }
  const space = (name) => tokens.space[name].$value
  const radius = (name) => tokens.radius[name].$value

  // ---- components: what an email's card is made of
  /** The small uppercase label (the app's eyebrow), as the card's h1. */
  const eyebrow = (text) =>
    `<h1 ${x('c-faint', `margin:0 0 ${px(space('ms'))};${type('eyebrow', 'mono')};text-transform:uppercase`)}>${text}</h1>`

  /** A paragraph of copy: `tone` is `muted` (default) or `faint`, `step` a step of the type scale. */
  const paragraph = (html, { tone = 'muted', step = 'subhead', style = '' } = {}) =>
    `<p ${x(`c-${tone}`, `margin:0;${type(step)};text-wrap:balance;${style}`)}>${html}</p>`

  /**
   * A code the member copies by hand: the app's code cell (a fill, a hairline ring, `md` corners, mono
   * figures) with the lamp's short rule under it, where the app marks the cell being typed into. One piece of
   * text, not six cells, so it selects with a triple tap and reads as one number. `text` is the code
   * or the template variable that stands for it. `size` and `tracking` (px) default to the six digits;
   * a longer code (an invite's `K7QM-X2PA`) passes smaller ones so it still fits a phone on one line.
   */
  const code = (text, { size = 36, tracking = 9 } = {}) => {
    return (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate"><tr>` +
      `<td align="center" ${x('bg-fill bc-hair', `border:1px solid;border-radius:${px(radius('md'))};padding:${px(space('lg'))} ${px(space('ms'))}`)}>` +
      // Letter-spacing trails the last digit; the same padding on the left keeps the six centred.
      `<div ${x('c-ink', `margin:0;font-family:${families.mono};font-size:${px(size)};line-height:${px(size + 8)};font-weight:500;letter-spacing:${px(tracking)};padding-left:${px(tracking)};white-space:nowrap;-webkit-user-select:all;user-select:all`)}>${text}</div>` +
      // The lamp rule: the focused field's 2 px line, short and centred under the digits.
      `<div ${x('bg-accent', `width:${px(size)};height:${px(tokens.stroke.focus.$value)};line-height:${px(tokens.stroke.focus.$value)};font-size:1px;margin:${px(space('ms'))} auto 0;border-radius:${px(radius('pill'))}`)}>&nbsp;</div>` +
      `</td></tr></table>`
    )
  }

  /**
   * A link that looks like the app's primary button: the ink pill, full width, the label in on-ink.
   * A table cell carries the fill so clients that drop padding on links (Outlook) still draw the
   * button; the whole pill is the link everywhere else. `href` is escaped by whoever fills it in.
   */
  const button = (href, label) => {
    const height = tokens.size.button.$value
    const pill = `border-radius:${px(radius('pill'))}`
    return (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate"><tr>` +
      `<td align="center" ${x('bg-ink', pill)}>` +
      `<a href="${href}" ${x('c-on-ink', `display:block;${type('bodyLarge')};line-height:${px(height)};font-weight:500;text-align:center;text-decoration:none;${pill}`)}>${label}</a>` +
      `</td></tr></table>`
    )
  }

  // ---- the document
  const darkRules = () => {
    const rules = (select) =>
      Object.entries(PAINT)
        .filter(([name]) => used.has(name))
        .map(([name, [prop, role]]) => `${select(name)}{${prop}:${palette.dark[role]}!important}`)
    const outlook = (attr) => rules((name) => `[${attr}] .${name}`)
    return [
      '@media (prefers-color-scheme:dark){',
      ...rules((name) => `.${name}`),
      '}',
      // Outlook.com's own dark mode rewrites colours unless it finds these attribute selectors.
      ...outlook('data-ogsc').filter((r) => !r.includes('background-color')),
      ...outlook('data-ogsb').filter((r) => r.includes('background-color')),
    ].join('\n')
  }

  /**
   * The whole document. `content` is the card's inside (eyebrow, paragraphs, a code), `footer` the
   * small line under the card, `preheader` the inbox preview text (hidden in the mail itself).
   */
  const render = ({ lang = 'en', title, preheader, content, footer = '' }) => {
    const maxWidth = tokens.size.maxContent.$value
    const wordmark = type('wordmark', 'serif', { fontSize: 44, lineHeight: 48 })
    const body =
      `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${palette.light.page};opacity:0">${preheader}${'&zwnj;&nbsp;'.repeat(40)}</div>\n` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${palette.light.page}" ${x('bg-page', 'width:100%')}><tr>` +
      `<td align="center" style="padding:${px(space('xxl'))} ${px(space('screen'))}">\n` +
      `<!--[if mso]><table role="presentation" width="${maxWidth}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->\n` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${maxWidth}px">\n` +
      // header: the wordmark and the tagline, as on the way-in screens
      `<tr><td align="center" style="padding:0 0 ${px(space('xl'))}">` +
      `<p ${x('c-ink', `margin:0;${wordmark};font-style:italic`)}>libellus</p>` +
      `<p ${x('c-muted-page', `margin:${px(space('sm'))} 0 0;${type('body')}`)}>The books you read, kept quietly.</p>` +
      `</td></tr>\n` +
      // card
      `<tr><td ${x('bg-card bc-hair', `border:1px solid;border-radius:${px(radius('lg'))};padding:${px(space('lg'))}`)} bgcolor="${palette.light.card}">\n${content}\n</td></tr>\n` +
      // footer
      (footer
        ? `<tr><td align="center" ${x('c-faint-page', `padding:${px(space('lg'))} ${px(space('md'))} 0;${type('footnote')}`)}>${footer}</td></tr>\n`
        : '') +
      `</table>\n` +
      `<!--[if mso]></td></tr></table><![endif]-->\n` +
      `</td></tr></table>`

    return [
      '<!doctype html>',
      `<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">`,
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
      '<meta name="x-apple-disable-message-reformatting">',
      '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">',
      '<meta name="color-scheme" content="light dark">',
      '<meta name="supported-color-schemes" content="light dark">',
      `<title>${title}</title>`,
      '<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->',
      '<!-- Generated by design/emails.mjs from design/tokens.json. Do not edit; see docs/DEVELOPMENT.md, "Emails". -->',
      `<style>\n:root{color-scheme:light dark;supported-color-schemes:light dark}\nbody{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}\n${darkRules()}\n</style>`,
      '</head>',
      `<body ${x('bg-page', 'margin:0;padding:0')}>`,
      `<div role="article" aria-roledescription="email" aria-label="${title}" lang="${lang}">`,
      body,
      '</div>',
      '</body>',
      '</html>',
      '',
    ].join('\n')
  }

  return { x, px, type, space, radius, eyebrow, paragraph, code, button, render, palette }
}
