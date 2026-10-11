/**
 * Your shelf for everyone, the proof's covers: synthetic but real-looking front covers (a ground,
 * one motif, the title in type, the author), drawn here as SVG and rasterised with sharp. No
 * publisher's art, no real Book: the titles are made up. The first twelve are the colour rule's
 * contact sheet (pure-ish white, near-black, a mid grey, a neon, deep blues, a yellow …), the rest
 * vary them for a 40-Book shelf. perf/serve.mjs serves them (any box Apple's URL asks for);
 * perf/shelf-seed.ts stores their colours as the app would (`coverColors`, a thumbhash).
 */
import sharp from 'sharp'

export type ProofCover = {
  n: number
  title: string
  author: string
  ground: string
  ink: string
  motif: 'sun' | 'line' | 'circle' | 'kite' | 'dot' | 'stars' | 'waves' | 'block' | 'rain' | 'halo' | 'signal' | 'trees'
  accent: string
}

/** The contact sheet's twelve (tests/book-colour.test.ts uses their most common colours too). */
export const CONTACT_SHEET: ProofCover[] = [
  { n: 1, title: 'The Salt Road', author: 'Mara Ellison', ground: '#e2a04a', ink: '#3a2412', motif: 'sun', accent: '#8c3b16' },
  { n: 2, title: 'White Hours', author: 'Jonas Riedel', ground: '#f4f1ea', ink: '#141414', motif: 'line', accent: '#141414' },
  { n: 3, title: 'Harbour of Glass', author: 'Iris Okafor', ground: '#1f3f5b', ink: '#f2e8d5', motif: 'circle', accent: '#e9c46a' },
  { n: 4, title: 'Yellow Kite', author: 'Paul Brandt', ground: '#f6c90e', ink: '#111111', motif: 'kite', accent: '#111111' },
  { n: 5, title: 'Night Freight', author: 'Vera Lang', ground: '#0b0b0d', ink: '#eeeeee', motif: 'dot', accent: '#ff7a1a' },
  { n: 6, title: 'The Quiet Archive', author: 'Hugo Thalberg', ground: '#14254a', ink: '#f5efe0', motif: 'stars', accent: '#f5efe0' },
  { n: 7, title: 'Seagrass', author: 'Klara Winter', ground: '#7fb6a4', ink: '#0f2a22', motif: 'waves', accent: '#f4f1ea' },
  { n: 8, title: 'Copper Island', author: 'Felix Adler', ground: '#c56b2a', ink: '#fff4e6', motif: 'block', accent: '#4a1f08' },
  { n: 9, title: 'Grey Weather', author: 'Rosa Keller', ground: '#8a8a88', ink: '#ffffff', motif: 'rain', accent: '#d9d9d6' },
  { n: 10, title: 'Neon Saints', author: 'Zoe Quast', ground: '#ff1fa8', ink: '#1a001a', motif: 'halo', accent: '#39ff14' },
  { n: 11, title: 'Blue Hour Signal', author: 'Noah Iversen', ground: '#2ec4f1', ink: '#04202b', motif: 'signal', accent: '#ffffff' },
  { n: 12, title: 'The Long Forest', author: 'Greta Pohl', ground: '#3d6b35', ink: '#f1ead2', motif: 'trees', accent: '#a8c686' },
]

const TITLE_A = 'Paper Winter Hollow Distant Burning Silent Golden Second Open Lost Iron Midnight Glass Quiet'.split(' ')
const TITLE_B = 'Garden Letters Orchard Atlas Season Harbour Mirror Voyage Border Chorus Machine Kingdom Archive River'.split(' ')
const NAMES = 'Anna Fischer|Ben Schulz|Clara Engel|David Graf|Elena Vogel|Lukas Maier|Mira Neumann|Olga Richter|Sven Ulrich|Tara Zimmer|Willa Hartmann|Yara Jung|Quinn Czerny|Uwe Dietrich'.split('|')

/** 40 covers: the twelve, then variations on them (another title, the ground's hue turned). */
export function proofCovers(count = 40): ProofCover[] {
  const covers = [...CONTACT_SHEET]
  for (let i = covers.length; i < count; i++) {
    const base = CONTACT_SHEET[i % CONTACT_SHEET.length]!
    covers.push({
      ...base,
      n: i + 1,
      title: `${i % 3 === 0 ? 'The ' : ''}${TITLE_A[i % TITLE_A.length]} ${TITLE_B[(i * 5) % TITLE_B.length]}`,
      author: NAMES[i % NAMES.length]!,
      ground: turn(base.ground, (i * 37) % 360),
      accent: turn(base.accent, (i * 37) % 360),
    })
  }
  return covers.slice(0, count)
}

function turn(hex: string, degrees: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return hex
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6
  h = (h + degrees / 360) % 1
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return `#${[f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

function motif(cover: ProofCover): string {
  const a = cover.accent
  switch (cover.motif) {
    case 'sun':
      return `<circle cx="300" cy="520" r="170" fill="${a}"/><rect x="0" y="600" width="600" height="300" fill="${cover.ground}" opacity="0.92"/>`
    case 'line':
      return `<rect x="60" y="430" width="480" height="3" fill="${a}"/>`
    case 'circle':
      return `<circle cx="300" cy="560" r="150" fill="none" stroke="${a}" stroke-width="10"/><circle cx="300" cy="560" r="60" fill="${a}" opacity="0.5"/>`
    case 'kite':
      return `<path d="M300 330 L420 520 L300 720 L180 520 Z" fill="${a}"/><path d="M300 720 Q330 800 280 860" stroke="${a}" stroke-width="5" fill="none"/>`
    case 'dot':
      return `<circle cx="430" cy="640" r="26" fill="${a}"/>`
    case 'stars':
      return Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 137) % 560 + 20}" cy="${(i * 211) % 420 + 380}" r="${(i % 3) + 1.5}" fill="${a}"/>`).join('')
    case 'waves':
      return Array.from({ length: 6 }, (_, i) => `<path d="M0 ${480 + i * 50} Q150 ${450 + i * 50} 300 ${480 + i * 50} T600 ${480 + i * 50}" stroke="${a}" stroke-width="6" fill="none" opacity="0.8"/>`).join('')
    case 'block':
      return `<rect x="0" y="430" width="600" height="300" fill="${a}"/>`
    case 'rain':
      return Array.from({ length: 30 }, (_, i) => `<rect x="${(i * 97) % 580 + 10}" y="${(i * 53) % 380 + 380}" width="2" height="60" fill="${a}"/>`).join('')
    case 'halo':
      return `<circle cx="300" cy="560" r="180" fill="none" stroke="${a}" stroke-width="16"/><circle cx="300" cy="560" r="110" fill="${a}" opacity="0.85"/>`
    case 'signal':
      return Array.from({ length: 4 }, (_, i) => `<circle cx="300" cy="620" r="${50 + i * 55}" fill="none" stroke="${a}" stroke-width="6" opacity="${1 - i * 0.2}"/>`).join('')
    case 'trees':
      return Array.from({ length: 7 }, (_, i) => `<path d="M${40 + i * 85} 760 L${80 + i * 85} ${520 + (i % 3) * 40} L${120 + i * 85} 760 Z" fill="${a}"/>`).join('')
  }
}

/** The front as SVG, 600 × 900. */
export function coverSvg(cover: ProofCover): string {
  const words = cover.title.split(' ')
  const lines: string[] = []
  for (const word of words) {
    const last = lines.at(-1)
    if (last && `${last} ${word}`.length <= 12) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  const title = lines
    .map((line, i) => `<text x="60" y="${150 + i * 78}" font-family="Georgia, 'Times New Roman', serif" font-size="70" font-weight="700" fill="${cover.ink}">${escape(line)}</text>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
<rect width="600" height="900" fill="${cover.ground}"/>
${motif(cover)}
${title}
<text x="60" y="840" font-family="Helvetica, Arial, sans-serif" font-size="30" letter-spacing="4" fill="${cover.ink}">${escape(cover.author.toUpperCase())}</text>
</svg>`
}

const rendered = new Map<string, Promise<Buffer>>()

/** The cover as a JPEG at Apple's box `w × h` (fit inside, as Apple's `bb` does). */
export function coverJpeg(cover: ProofCover, w: number, h: number): Promise<Buffer> {
  const key = `${cover.n}:${w}x${h}`
  let out = rendered.get(key)
  if (!out) {
    out = sharp(Buffer.from(coverSvg(cover))).resize(w, h, { fit: 'inside' }).jpeg({ quality: 82 }).toBuffer()
    rendered.set(key, out)
  }
  return out
}

/** A small raw copy of the cover (RGBA), for the colours the app stores with it (perf/shelf-seed.ts). */
export async function coverPixels(cover: ProofCover): Promise<{ width: number; height: number; data: Uint8Array }> {
  const { data, info } = await sharp(Buffer.from(coverSvg(cover))).resize(64, 96, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data) }
}

/** A proof cover's Apple-like address: the app's `coverSrc` asks Apple's CDN for other boxes the same way. */
export const proofCoverUrl = (n: number) => `https://is1-ssl.mzstatic.com/image/thumb/Publication/shelfproof/${n}/cover.jpg/600x900bb.jpg`
export const PROOF_COVER = /\/shelfproof\/(\d+)\/cover\.jpg\/(\d+)x(\d+)bb\.jpg$/
