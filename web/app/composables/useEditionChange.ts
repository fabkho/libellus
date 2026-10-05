/**
 * Change edition on the book page (docs/MOTION.md, Change edition; #61): the
 * page stays the same page (utils/bookPageKey.ts) and the hero turns from the
 * old Book into the new one. The old cover, title, author and facts and what
 * the Book is about are copied the moment before the page draws the new Book
 * (`capture`, in a pre-flush watcher), and laid over the new ones (`play`):
 * the old ones fade out as the new ones fade in, over `standard`, the light
 * they throw turns from the old cover's colours to the new one's, and the
 * content below slides from where it was to where it is now (a longer title
 * pushes it down). With Reduce Motion nothing slides.
 *
 * The change waits, holding the old Book on screen, until the Change edition
 * sheet has fallen away (`useModalShown`) and the new cover's image is decoded
 * (so the cover never cross-fades into its thumbhash), at most twice `sheet`;
 * then the new cover is shown whatever it has, and fades its image in itself.
 * Interruptible: a new change, leaving the page or the page going away ends a
 * running one at once, the new Book in place.
 */
import type { Ref } from 'vue'
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'

interface Parts {
  /** The page's root: the ambient light is its first child. */
  page: Readonly<Ref<HTMLElement | null>>
  /** The hero section (cover, title, author, facts). */
  hero: Readonly<Ref<HTMLElement | null>>
  /** Empty, last in the hero: the old hero is laid here, over the new one. */
  heroWas: Readonly<Ref<HTMLElement | null>>
  /** Empty, right after the ambient light: the old text about the Book is laid here. */
  pageWas: Readonly<Ref<HTMLElement | null>>
}

interface Captured {
  /** The old hero, laid out as it was (a copy of the section with its content). */
  hero: HTMLElement
  /** The two colours of the old light (UiAmbient's `--pool-a`, `--pool-b`). */
  light: { a: string; b: string } | null
  /** What the old Book was about, laid out where it was. */
  about: HTMLElement | null
  /** Where the content after the hero began. */
  bottom: number
}

const AMBIENT = '.ambient'
/** What the Book is about: the edition's own text, below the actions. */
const ABOUT = '[data-testid="book.about"]'
const COVER = '[data-cover]'
/** The parts of UiCover that fade by themselves (its image, the halo, the pool). */
const FADING = 'img, .halo, .pool'

/** A dead copy: no ids, test IDs or cover marks (the flight looks for those), nothing to focus. */
function copyOf(element: Element): HTMLElement {
  const copied = element.cloneNode(true) as HTMLElement
  for (const node of [copied, ...copied.querySelectorAll('*')]) {
    node.removeAttribute('id')
    node.removeAttribute('data-testid')
    node.removeAttribute('data-cover')
    node.removeAttribute('data-flight-hidden')
    if (node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
    if (node instanceof HTMLImageElement) {
      node.loading = 'eager'
      node.decoding = 'sync'
    }
  }
  return copied
}

export function useEditionChange(parts: Parts) {
  const covered = useModalShown()
  let captured: Captured | null = null
  let running: { animations: Animation[]; frame: number; quiet: HTMLElement[]; copies: HTMLElement[] } | null = null

  function liveContent(hero: HTMLElement): HTMLElement[] {
    return [...hero.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== parts.heroWas.value)
  }

  function after(hero: HTMLElement): HTMLElement[] {
    const all: HTMLElement[] = []
    for (let next = hero.nextElementSibling; next; next = next.nextElementSibling) if (next instanceof HTMLElement) all.push(next)
    return all
  }

  /** The new Book in place at once: copies gone, nothing moving. */
  function finish() {
    captured = null
    if (!running) return
    cancelAnimationFrame(running.frame)
    for (const animation of running.animations) animation.cancel()
    for (const element of running.quiet) element.style.transition = ''
    for (const copy of running.copies) copy.remove()
    running = null
  }

  /** The old Book as it is on screen, the moment before the page draws the new one. */
  function capture() {
    finish()
    const hero = parts.hero.value
    const page = parts.page.value
    if (!hero || !page) return
    const was = copyOf(hero)
    // Laid out as the hero was: the section itself, at its width, from its top left.
    was.querySelector(':scope > [data-edition-was]')?.remove()
    Object.assign(was.style, { position: 'absolute', left: '0', top: '0', width: `${hero.offsetWidth}px`, margin: '0' })
    registerLight()
    const ambient = page.querySelector(`:scope > ${AMBIENT}`)
    const lit = ambient && getComputedStyle(ambient)
    const aboutNow = page.querySelector<HTMLElement>(`:scope > ${ABOUT}`)
    let about: HTMLElement | null = null
    if (aboutNow) {
      about = copyOf(aboutNow)
      const at = { left: `${aboutNow.offsetLeft}px`, top: `${aboutNow.offsetTop}px`, width: `${aboutNow.offsetWidth}px` }
      Object.assign(about.style, { position: 'absolute', margin: '0', ...at })
    }
    const light = lit ? { a: lit.getPropertyValue('--pool-a').trim(), b: lit.getPropertyValue('--pool-b').trim() } : null
    captured = { hero: was, light, about, bottom: hero.offsetTop + hero.offsetHeight }
  }

  /** The new Book is drawn: lay the old one over it and turn one into the other. */
  function play() {
    const old = captured
    captured = null
    const hero = parts.hero.value
    const heroWas = parts.heroWas.value
    const pageWas = parts.pageWas.value
    const page = parts.page.value
    if (!old || !hero || !heroWas || !pageWas || !page) return

    const reduced = prefersReducedMotion()
    const duration = durationToken('standard')
    const easing = easingToken('standard')
    const animations: Animation[] = []
    const fade = (element: Element, from: number, to: number) => {
      const animation = element.animate([{ opacity: from }, { opacity: to }], { duration, easing, fill: 'both' })
      animation.pause()
      animations.push(animation)
    }

    heroWas.appendChild(old.hero)
    const copies = [old.hero]
    if (old.about) {
      pageWas.appendChild(old.about)
      copies.push(old.about)
    }
    const ambient = page.querySelector<HTMLElement>(`:scope > ${AMBIENT}`)
    const about = page.querySelector<HTMLElement>(`:scope > ${ABOUT}`)
    // The old hero fades out, the new one in.
    fade(old.hero, 1, 0)
    for (const element of liveContent(hero)) fade(element, 0, 1)
    // The light turns from the old colours to the new (to whatever they are by then: the
    // Placeholder's cloth is known a render later). Not a fade: the light's grain blends
    // with the page, and an element fading is drawn on its own.
    if (ambient && old.light?.a && old.light.b) {
      const animation = ambient.animate([{ offset: 0, '--pool-a': old.light.a, '--pool-b': old.light.b }], { duration, easing, fill: 'both' })
      animation.pause()
      animations.push(animation)
    }
    // What the Book is about is the edition's too: the old text fades out where it was, the new one in.
    if (old.about) fade(old.about, 1, 0)
    if (about) fade(about, 0, 1)
    // The content below holds where it began, then slides to where it begins now
    // (with Reduce Motion it takes its place at once, as the cross-fade starts).
    const shift = old.bottom - (hero.offsetTop + hero.offsetHeight)
    const slides: Animation[] = []
    if (shift)
      for (const element of after(hero)) {
        const animation = element.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration, easing, fill: 'both' })
        animation.pause()
        slides.push(animation)
      }
    if (!reduced) animations.push(...slides)

    // The new cover fades its image in by itself; under the old one it shows at once instead.
    const cover = hero.querySelector<HTMLElement>(COVER)?.parentElement ?? null
    const quiet = cover ? [...cover.querySelectorAll<HTMLElement>(FADING)] : []
    for (const element of quiet) element.style.transition = 'none'

    const motion = { animations: [...animations, ...(reduced ? slides : [])], frame: 0, quiet, copies }
    running = motion
    const until = performance.now() + 2 * durationToken('sheet')
    const go = () => {
      for (const element of quiet) element.style.transition = ''
      if (reduced) for (const animation of slides) animation.cancel()
      for (const animation of animations) animation.play()
      void Promise.all(animations.map((animation) => animation.finished)).then(
        () => running === motion && finish(),
        () => {},
      )
    }
    const wait = () => {
      if (running !== motion) return
      const ready = !cover || coverIn(cover)
      if (!covered.value && (ready || performance.now() > until)) go()
      else motion.frame = requestAnimationFrame(wait)
    }
    wait()
  }

  onBeforeRouteLeave(() => finish())
  onBeforeUnmount(() => finish())

  return { capture, play, finish }
}

let lightRegistered = false

/**
 * The light's two colours as colours, so they can be animated from one to the
 * other (unregistered custom properties only flip). Registered once, when an
 * edition first changes; the values UiAmbient and UiCover give them are colours.
 */
function registerLight() {
  if (lightRegistered || typeof CSS === 'undefined' || !('registerProperty' in CSS)) return
  lightRegistered = true
  for (const name of ['--pool-a', '--pool-b'])
    try {
      CSS.registerProperty({ name, syntax: '<color>', inherits: false, initialValue: 'transparent' })
    } catch {
      // Registered already (a reload in development): as good.
    }
}

/** The cover shows its image for good (or the cloth, which has none to wait for). */
function coverIn(cover: HTMLElement): boolean {
  const image = cover.querySelector(`${COVER} > img`)
  if (!(image instanceof HTMLImageElement)) return true
  return image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1'
}
