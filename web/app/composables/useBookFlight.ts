/**
 * Push to a book and back (docs/MOTION.md, Push to a book): the cover that was
 * tapped flies from where it is on screen into the book page's hero while the
 * book page fades and rises in over `standard`, and the page that was left
 * fades out; back plays it the other way over `exit`, into the list as it was
 * (same place, same scroll). A FLIP with the Web Animations API, like the
 * search morph, and interruptible like it: Back tapped mid-flight (or the
 * same book tapped again while it flies back) turns the flight around from
 * what is on screen.
 *
 * Who does what:
 * - `UiPressLink` calls `launch` in the tap that navigates: the tapped cover's
 *   box and a copy of it are taken then, with a still copy of the page being
 *   left (utils/snapshot.ts), because the router swaps the page at once.
 * - Leaving a book page by Back is noticed in `beforeEach`, again while the
 *   book page is still in the document. A Back the browser has animated itself
 *   (iOS Safari's edge swipe: `hasUAVisualTransition`) gets no flight on top.
 *   Other ways off a book page (a tab, a link) are new places: no flight.
 * - From then until the flight starts, the copy of the page being left stands
 *   in for the live page (`pose`), so the frame in which the router has drawn
 *   the new page but not resolved its scroll never shows it bare.
 * - The flight starts when the router has drawn the new page and is about to
 *   scroll it to its place (`scrollBehavior` resolving, before that frame is
 *   painted): the scroll is applied first, so every box is measured where it
 *   will be (the router then scrolls to the same place, a no-op). Scroll
 *   restoration (app/router.options.ts, utils/tabPlaces.ts) is untouched. Its
 *   first frame holds still until it is on screen (`letGo`).
 * - The tapped cover's image is the row's size: the hero's image is laid over
 *   it in the air once decoded (`sharpen`; `prepare` starts loading it on the
 *   press). A cover that lands with it before the hero's own image is in stays
 *   on the hero, in its sheet, until that image is decoded and faded in
 *   (`hold`); one that lands without it lands on its thumbhash, and the hero
 *   fades its image in there.
 * - `ShellBookFlight` (in the tabs layout) holds the two fixed layers: the
 *   leaving page's copy under the chrome, the flying cover over everything
 *   but the sheets.
 *
 * Each part of a flight is a channel (utils/flight.ts): the cover's travel,
 * the book page and the list. A flight that takes over from another reads each
 * channel's value off the screen and starts its own animation there.
 */
import type { RouteLocationNormalized, Router, RouterScrollBehavior } from 'vue-router'
import {
  AT_BOOK,
  AT_LIST,
  boxOf,
  isFlightPath,
  onScreen,
  startAt,
  transformFrom,
  valueOf,
  type Box,
  type Channels,
  type Towards,
} from '~/utils/flight'
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'
import { coverCopy, snapshotOf, type Snapshot } from '~/utils/snapshot'
import { coverSrc } from '~/utils/cover'
import { preloadImage } from '~/utils/preload'

/** The part of the shell that is the page: `main`, the tab page's header in it (layouts/tabs.vue; a public reading page's own, layouts/reading.vue). */
const PAGE = '[data-flight="page"]'
/** The hero of a book page or of a public Book card: the cover large, with the content that rises in after it. */
const HERO = '[data-flight="hero"]'
/** A cover's sheet (UiCover): the image or cloth, without its glow. */
const COVER = '[data-cover]'
/** A cover that is flying: the copy in the air stands in for it. */
const HIDDEN = 'data-flight-hidden'
const LAYER = '[data-flight-layer]'
/** On the flying layer while it flies to a row in a sheet: over the sheet (BookFlight.vue). */
const OVER_SHEET = 'data-over-sheet'
/** On the root while a flight is about to start: the live page is hidden under the copy of the page being left. */
const POSE = 'data-flight-pose'
/**
 * How long the copy of the page being left may stand in for it before the
 * navigation has drawn the new page (a slow first load of the page's code):
 * a safety net, not a motion; after it the live page shows again.
 */
const POSE_LIMIT_MS = 1000

/** How far a row's image may be blown up in the air (past its pixels at the screen's density) before it is gone (`sharpen`). */
const SOFT_SCALE = 1.15
/** The stretch of the way (0–1) over which it goes. */
const SOFT_FADE = 0.15

interface Layers {
  /** Under the chrome, over the page: the page being left. */
  under: HTMLElement
  /** Over everything but sheets: the flying cover. */
  over: HTMLElement
}

/** A flight about to start: taken while the page being left is still in the document. */
interface Departure {
  towards: Towards
  /** The book page's path. */
  path: string
  /** Where the navigation that starts it goes (to tell its failure from another's). */
  to: string
  from: Channels
  snapshot: Snapshot | null
  /** push: the tapped cover; pop: the hero's. */
  cover: HTMLElement | null
  box: Box | null
  copy: HTMLElement | null
  /** pop: the hero's cover had its image on screen (else the list's copy flies). */
  coverShown: boolean
  /** pop: the hero's corner radius (the hero is gone once the flight starts). */
  radius: string | null
  /** The cover in the air, where a flight being turned around left it. */
  air: { box: Box; copies: HTMLElement[] } | null
  /** pop: the copies of the book page's content, which sink as it leaves. */
  sinks: Element[]
  /** pop: the flight that was going the other way, paused where it was. */
  previous: Flight | null
  /** push: where it started, so that Back knows whether the cover can go back. */
  origin: Origin | null
}

interface Origin {
  /** The page the book was opened from. */
  page: string
  /** Opened from the search palette, which is gone when Back is tapped. */
  search: boolean
}

interface Flight {
  towards: Towards
  path: string
  /** The cover's box in the list, on the book page. */
  rowBox: Box | null
  heroBox: Box | null
  /** The live covers hidden while a copy flies for them. */
  hidden: HTMLElement[]
  hero: HTMLElement | null
  fly: HTMLElement | null
  snapshot: HTMLElement | null
  channels: Record<keyof Channels, Animation[]>
  /** Animations created since the last frame, held still on their first one (`letGo`). */
  held: Animation[]
  /** The cover's channel while it has no animation (waiting for the hero, or fading in place). */
  coverValue: number
  /** A push whose hero is not drawn yet: looks again each frame until this time. */
  waitUntil: number | null
  /** A push's content has started to rise (once its hero is drawn). */
  risen: boolean
  /** A pop: the list's live cover the copy lands on (`handOff`). */
  row: HTMLElement | null
  /** A push: the hero's own (large) image, laid over the tapped cover's in the air (`sharpen`). */
  sharp: HTMLImageElement | null
  /** The large image is decoded and showing (or fading in) in the air: the copy may stay on the hero (`hold`). */
  sharpShown: boolean
  origin: Origin | null
}

let layers: Layers | null = null
let router: Router | null = null
let pending: Departure | null = null
let running: Flight | null = null
let releaseHold: ((gently?: boolean) => void) | null = null
/** The pose a departure put up (its copy of the page being left, if it added one) and its safety timer. */
let posed: { root: HTMLElement | null; timer: number } | null = null
/** The last Back was a swipe the browser already animated (iOS Safari's edge swipe): no flight on top of it. */
let browserAnimatedBack = false
/** The history position (vue-router's `history.state.position`) of the page showing. */
let entryPosition: number | null = null
/** How many books' origins are remembered (the last ones pushed). */
const ORIGINS_KEPT = 50
const origins = new Map<string, Origin>()

// ------------------------------------------------------------ measuring

const box = (element: Element) => boxOf(element.getBoundingClientRect())
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })
const inLayer = (element: Element) => Boolean(element.closest(LAYER))
/** The page as it is in the document now (never a copy of one in the flight's layers). */
const livePage = () => [...document.querySelectorAll<HTMLElement>(PAGE)].filter((element) => !inLayer(element))

/** The cover of a link to `path` on screen now (a Home card's title shares its card's cover). */
function coverFor(path: string): HTMLElement | null {
  const href = router?.resolve(path).href ?? path
  let fallback: HTMLElement | null = null
  for (const link of document.querySelectorAll('a[href]')) {
    if (link.getAttribute('href') !== href || inLayer(link)) continue
    const cover = link.querySelector<HTMLElement>(COVER)
    if (!cover) continue
    const at = box(cover)
    if (onScreen(at, viewport())) return cover
    if (at.width) fallback ??= cover
  }
  return fallback
}

/**
 * The cover shows what it will show for good: its image drawn (or the cloth,
 * which has none to wait for). UiCover fades its image in only once it is
 * decoded, so an image at full opacity is one on screen. Its own image only:
 * a copy held over it (`hold`) has one too.
 */
function shown(cover: Element): boolean {
  const image = cover.querySelector(':scope > img')
  if (!(image instanceof HTMLImageElement)) return true
  return image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1'
}

/** Where a flight being turned around has its cover now, and copies of what it shows. */
function airOf(flight: Flight | null): Departure['air'] {
  const fly = flight?.fly
  if (!fly) return null
  return { box: box(fly), copies: [...fly.children].map((child) => coverCopy(child)) }
}

/** The vertical translation an element is drawn with (the book page's rise), so a measurement can leave it out. */
function lifted(element: Element | null): number {
  const transform = element ? getComputedStyle(element).transform : 'none'
  return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0
}

/** The hero cover's box as laid out, without the page's rise (which may be under way). */
function heroBoxOf(hero: HTMLElement): Box {
  const drawn = box(hero)
  return { ...drawn, top: drawn.top - lifted(document.querySelector(HERO)) }
}

/** The book page's content from the hero down: what rises in (the top bar and the light only fade). */
function risers(): HTMLElement[] {
  const hero = document.querySelector<HTMLElement>(HERO)
  if (!hero) return []
  const all = [hero]
  for (let next = hero.nextElementSibling; next; next = next.nextElementSibling)
    if (next instanceof HTMLElement) all.push(next)
  return all
}

function rise(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-md')) || 0
}

// ------------------------------------------------------------ channels

/**
 * Duration and curve of a flight: `standard` towards the book page, `exit`
 * back (arrive slow, leave fast). Every part runs on the `standard` curve, as
 * the search morph does both ways: the cover lands softly in its row, and the
 * two pages cross-dissolve (one's opacity is the other's complement), so the
 * one leaving is mostly gone by the time the one arriving has text to read.
 */
function timing(towards: Towards, reduced: boolean) {
  const duration = durationToken(towards === 'book' || reduced ? 'standard' : 'exit')
  return { duration, easing: easingToken('standard') }
}

/** Keyframes are written towards the book page; back plays them back to front (as the search morph does). */
function oriented(frames: Keyframe[], towards: Towards): Keyframe[] {
  // Back to front, with each keyframe's place in the animation (`offset`) turned the same way round.
  return towards === 'book' ? frames : [...frames].reverse().map((frame) => (typeof frame.offset === 'number' ? { ...frame, offset: 1 - frame.offset } : frame))
}

function play(element: Element, frames: Keyframe[], flight: Flight, channel: keyof Channels, value: number, reduced: boolean) {
  const { duration, easing } = timing(flight.towards, reduced)
  const animation = element.animate(oriented(frames, flight.towards), { duration, easing, fill: 'both' })
  animation.currentTime = startAt(value, flight.towards, easing, duration)
  flight.channels[channel].push(animation)
  // Held on its first frame (`letGo`).
  animation.playbackRate = 0
  flight.held.push(animation)
  return animation
}

/** Where each channel of a flight is on screen now. */
function channelsOf(flight: Flight): Channels {
  const read = (channel: keyof Channels, fallback: number) => {
    const first = flight.channels[channel][0]
    return first ? valueOf(first.effect?.getComputedTiming().progress, flight.towards) : fallback
  }
  const book = read('book', flight.towards === 'book' ? 1 : 0)
  return { book, list: read('list', book), cover: read('cover', flight.coverValue) }
}

function animations(flight: Flight): Animation[] {
  return [...flight.channels.cover, ...flight.channels.book, ...flight.channels.list]
}

// ------------------------------------------------------------ the flying cover

/** A fixed box laid out at the hero's size, holding copies of the cover; it is moved by transform only. */
function flyAt(at: Box, copies: HTMLElement[], radius: string | null): HTMLElement {
  const fly = document.createElement('div')
  fly.className = 'flight-cover'
  fly.dataset.testid = 'shell.flightCover'
  Object.assign(fly.style, { left: `${at.left}px`, top: `${at.top}px`, width: `${at.width}px`, height: `${at.height}px` })
  for (const copy of copies) {
    copy.classList.add('flight-copy')
    if (radius) copy.style.borderRadius = radius
    fly.appendChild(copy)
  }
  return fly
}

function hide(flight: Flight, cover: HTMLElement | null) {
  if (!cover) return
  cover.setAttribute(HIDDEN, '')
  flight.hidden.push(cover)
}

// ------------------------------------------------------------ starting

/**
 * A finger (or the mouse) went down on a link to a book page: called by
 * UiPressLink on the press, before the tap is known to be one. The book page's
 * cover image (the hero's size, not the row's) starts loading now, so it is
 * usually in by the time the cover flies and it flies sharp (`sharpen`).
 */
export function prepare(link: HTMLElement, to: string) {
  if (!router || !import.meta.client) return
  const path = router.resolve(to).path
  if (!isFlightPath(path) || path === router.currentRoute.value.path) return
  const image = (link.querySelector(COVER) ?? coverFor(path))?.querySelector<HTMLImageElement>(':scope > img')
  preloadImage(coverSrc(image?.currentSrc || image?.src, 'xl'))
}

/** A tap on a link to a book page: called by UiPressLink before it navigates. */
export function launch(link: HTMLElement, to: string) {
  if (!layers || !router || !import.meta.client) return
  const path = router.resolve(to).path
  if (!isFlightPath(path) || path === router.currentRoute.value.path) return
  const reduced = prefersReducedMotion()
  const previous = takeOver(path, 'list')
  const cover = reduced ? null : (link.querySelector<HTMLElement>(COVER) ?? coverFor(path))
  const search = Boolean(link.closest('[data-testid="search.overlay"]'))
  pending = {
    towards: 'book',
    path,
    to: router.resolve(to).fullPath,
    from: previous ? channelsOf(previous) : AT_LIST,
    snapshot: snapshotOf(livePage()),
    cover,
    box: cover ? box(cover) : null,
    copy: cover ? coverCopy(cover) : null,
    coverShown: cover ? shown(cover) : false,
    radius: null,
    air: airOf(previous),
    sinks: [],
    previous,
    origin: { page: router.currentRoute.value.fullPath, search },
  }
  pose(pending)
}

/**
 * Until its flight starts, a departure holds the screen as it was: the copy of
 * the page being left goes up now, whole (its cover too: nothing flies yet),
 * and the live page under it is hidden. The router draws the new page and only
 * then resolves its scroll, a frame or more later on a slow device; without
 * this that frame shows the new page bare, before the flight is in place.
 * A flight turned around needs none: the one it takes over holds the screen.
 */
function pose(departure: Departure) {
  unpose()
  if (!layers || departure.previous) return
  document.documentElement.setAttribute(POSE, '')
  const snapshot = departure.snapshot
  if (snapshot) attach(snapshot)
  posed = { root: snapshot?.root ?? null, timer: window.setTimeout(unpose, POSE_LIMIT_MS) }
}

/** The live page shows again; a copy the pose put up and no flight took over leaves. */
function unpose() {
  document.documentElement.removeAttribute(POSE)
  if (!posed) return
  window.clearTimeout(posed.timer)
  posed.root?.remove()
  posed = null
}

/** The copy of the page being left goes into the under layer (once). */
function attach(snapshot: Snapshot) {
  if (!layers || snapshot.root.parentElement === layers.under) return
  snapshot.root.style.willChange = 'opacity'
  layers.under.appendChild(snapshot.root)
  snapshot.settle()
}

/** The copy of an element in the copy of the page left stands aside: a copy of it flies instead. */
function standAside(snapshot: Snapshot | null, element: Element | null) {
  const copy = element && snapshot?.copyOf(element)
  if (copy instanceof HTMLElement || copy instanceof SVGElement) copy.style.visibility = 'hidden'
}

/** Leaving a book page by Back: noticed while the book page is still there. */
function leaving(to: RouteLocationNormalized, from: RouteLocationNormalized) {
  if (pending || !isFlightPath(from.path) || to.path === from.path) return
  // Only Back reverses the push; a tab or a link from the book page is a new place (no motion).
  if (!isBack(to, from)) return
  const reduced = prefersReducedMotion()
  const previous = takeOver(from.path, 'book')
  const hero = document.querySelector<HTMLElement>(`${HERO} ${COVER}`)
  const snapshot = snapshotOf(livePage())
  pending = {
    towards: 'list',
    path: from.path,
    to: to.fullPath,
    from: previous ? channelsOf(previous) : AT_BOOK,
    snapshot,
    cover: hero,
    box: previous?.heroBox ?? (hero ? heroBoxOf(hero) : null),
    copy: hero && !reduced ? coverCopy(hero) : null,
    coverShown: hero ? shown(hero) : false,
    radius: hero ? getComputedStyle(hero).borderRadius : null,
    air: airOf(previous),
    sinks: reduced ? [] : risers().flatMap((element) => snapshot.copyOf(element) ?? []),
    previous,
    origin: previous?.origin ?? origins.get(from.path) ?? null,
  }
  // A swipe the browser animated has already shown the list: nothing to hold.
  if (!browserAnimatedBack) pose(pending)
}

/**
 * The navigation going on is the browser's Back (a popstate, which has already
 * made the destination's history entry current): from the entry the book page
 * was pushed onto, or from further on (its address replaced since, by a change
 * of edition).
 */
function isBack(to: RouteLocationNormalized, from: RouteLocationNormalized): boolean {
  const state = window.history.state as { current?: string; forward?: string | null; position?: number } | null
  if (!state || state.current !== to.fullPath) return false
  if (state.forward === from.fullPath) return true
  return typeof state.position === 'number' && entryPosition !== null && state.position < entryPosition
}

/**
 * A new flight is about to start: the running one, if it is the same book
 * going the other way, is paused where it is (the new one starts from there);
 * any other flight lands at once.
 */
function takeOver(path: string, was: Towards): Flight | null {
  const flight = running
  if (!flight) return null
  if (flight.path === path && flight.towards === was) {
    for (const animation of animations(flight)) animation.pause()
    flight.waitUntil = null
    return flight
  }
  land(flight)
  return null
}

/** The router has drawn the new page and is about to scroll it: start the flight that was waiting for it. */
function arrive(to: RouteLocationNormalized, from: RouteLocationNormalized, position: unknown) {
  try {
    start(to, from, position)
  } catch (error) {
    // A flight that cannot start must not leave a cover hidden or a page copy on screen.
    pending = null
    unpose()
    if (running) drop(running)
    console.error(error)
  }
}

function start(to: RouteLocationNormalized, from: RouteLocationNormalized, position: unknown) {
  const departure = pending
  pending = null
  // The browser animated this Back itself (its edge swipe): the page is simply there.
  const swiped = departure?.towards === 'list' && browserAnimatedBack
  browserAnimatedBack = false
  // Superseded by a newer navigation before it was drawn: that one's flight (or none) follows.
  const current = router?.currentRoute.value.fullPath === to.fullPath
  const fits =
    current &&
    !swiped &&
    departure &&
    (departure.towards === 'book' ? to.path === departure.path : from.path === departure.path && to.path !== departure.path)
  if (!departure || !fits || !layers) {
    unpose()
    if (departure?.previous) land(departure.previous)
    else if (running && current && to.path !== from.path) land(running)
    return
  }
  // The place the router is about to scroll to, applied now so the boxes are measured there.
  if (position && typeof position === 'object' && 'top' in position && typeof position.top === 'number') {
    const left = 'left' in position && typeof position.left === 'number' ? position.left : 0
    window.scrollTo({ left, top: position.top, behavior: 'instant' })
  }
  const previous = departure.previous
  if (previous) drop(previous)
  if (departure.towards === 'book') push(departure)
  else pop(departure, to)
  // The flight's first frame is in place (its animations hold the page's opacity now): the pose can go.
  unpose()
}

function fresh(departure: Departure): Flight {
  return {
    towards: departure.towards,
    path: departure.path,
    rowBox: null,
    heroBox: null,
    hidden: [],
    hero: null,
    fly: null,
    snapshot: null,
    channels: { cover: [], book: [], list: [] },
    held: [],
    coverValue: departure.from.cover,
    waitUntil: null,
    risen: false,
    row: null,
    sharp: null,
    sharpShown: false,
    origin: departure.origin,
  }
}

/** Shows the page being left, as it was, in the under layer (where the pose may have put it already). */
function showLeaving(flight: Flight, snapshot: Snapshot | null) {
  if (!snapshot || !layers) return
  attach(snapshot)
  // The flight owns the copy now: the pose leaving does not take it along.
  if (posed?.root === snapshot.root) posed.root = null
  flight.snapshot = snapshot.root
}

function push(departure: Departure) {
  const reduced = prefersReducedMotion()
  const flight = fresh(departure)
  running = flight
  const { from } = departure

  showLeaving(flight, departure.snapshot)
  if (flight.snapshot) play(flight.snapshot, [{ opacity: 1 }, { opacity: 0 }], flight, 'list', from.list, reduced)
  for (const page of livePage())
    play(page, [{ opacity: 0 }, { opacity: 1 }], flight, 'book', from.book, reduced)
  if (!reduced) riseIn(flight, from.book)

  if (departure.cover && departure.box && departure.copy && layers) {
    // The tapped cover, if it is still on screen (in the closing search palette), is the one in the air now.
    if (departure.cover.isConnected) hide(flight, departure.cover)
    standAside(departure.snapshot, departure.cover)
    flight.rowBox = departure.previous?.rowBox ?? departure.box
    flight.fly = flyAt(departure.air?.box ?? departure.box, [departure.copy], null)
    layers.over.appendChild(flight.fly)
    if (!aim(flight, from.cover)) flight.waitUntil = performance.now() + durationToken('standard')
  }
  track(flight)
}

/** The book page's content from the hero down rises into place (once there is a hero), from where the page's fade is. */
function riseIn(flight: Flight, value: number) {
  const elements = risers()
  if (flight.risen || !elements.length) return
  flight.risen = true
  const distance = rise()
  for (const element of elements)
    play(element, [{ transform: `translateY(${distance}px)` }, { transform: 'none' }], flight, 'book', value, false)
}

/** Sends a push's cover to the hero once the hero is drawn; false while it is not. */
function aim(flight: Flight, value: number): boolean {
  const hero = document.querySelector<HTMLElement>(`${HERO} ${COVER}`)
  const fly = flight.fly
  const rowBox = flight.rowBox
  if (!hero || !fly || !rowBox) return false
  const heroBox = heroBoxOf(hero)
  if (!heroBox.width) return false
  flight.hero = hero
  flight.heroBox = heroBox
  flight.waitUntil = null
  hide(flight, hero)
  riseIn(flight, channelsOf(flight).book)
  // Laid out at the hero's size, drawn at the list's: the copy lands at exactly the hero's pixels.
  const radius = getComputedStyle(hero).borderRadius
  const copies = [...fly.children] as HTMLElement[]
  Object.assign(fly.style, { left: `${heroBox.left}px`, top: `${heroBox.top}px`, width: `${heroBox.width}px`, height: `${heroBox.height}px` })
  for (const copy of copies) copy.style.borderRadius = radius
  const image = hero.querySelector<HTMLImageElement>(':scope > img')
  if (image) sharpen(flight, image, copies, rowBox, heroBox, value)
  else {
    // A Placeholder: the hero's cloth, with its type, fades in over the list's on the way.
    const top = coverCopy(hero)
    top.classList.add('flight-copy')
    top.style.borderRadius = radius
    fly.appendChild(top)
    play(top, [{ opacity: 0 }, { opacity: 1 }], flight, 'cover', value, false)
  }
  play(fly, [{ transform: transformFrom(heroBox, rowBox) }, { transform: 'none' }], flight, 'cover', value, false)
  return true
}

/**
 * The row's image (sized for its row) is gone by the time the cover is larger
 * than it holds sharply (at the screen's density, blown up by a little at
 * most): over the stretch of the way before that. Written towards the book
 * page like every channel, so on the way back the image returns as the cover
 * shrinks to what it holds.
 */
function fadeSoft(flight: Flight, copies: HTMLElement[], rowBox: Box, heroBox: Box, value: number, except: HTMLImageElement | null = null) {
  const rows = copies.flatMap((copy) => [...copy.querySelectorAll<HTMLImageElement>(':scope > img')]).filter((image) => image !== except)
  for (const row of rows) {
    const holds = ((row.naturalWidth || rowBox.width) / (window.devicePixelRatio || 1)) * SOFT_SCALE
    const gone = Math.min(Math.max((holds - rowBox.width) / Math.max(heroBox.width - rowBox.width, 1), SOFT_FADE), 1)
    play(
      row,
      [{ opacity: 1 }, { opacity: 1, offset: gone - SOFT_FADE }, { opacity: 0, offset: gone }, { opacity: 0 }],
      flight,
      'cover',
      value,
      false,
    )
  }
}

/**
 * The hero's own image, in the air (docs/MOTION.md, Push to a book). The tapped
 * cover's image is sized for its row (a list row asks for 120 × 180,
 * utils/cover.ts), so blown up to the hero it is a blur. The hero's image is
 * laid over it in the copy that flies, under its finish, as soon as it is
 * decoded: at once when it is in already (asked for when the finger went
 * down, `prepare`), or faded in over `quick` when it arrives on the way. Until
 * then the row's image goes as the cover grows past what it holds sharply,
 * leaving the thumbhash under it: on a slow network the cover lands on its
 * thumbhash and the hero's image fades in there, never the small one enlarged.
 */
function sharpen(flight: Flight, hero: HTMLImageElement, copies: HTMLElement[], rowBox: Box, heroBox: Box, value: number) {
  const sheet = copies.at(-1)
  const src = hero.currentSrc || hero.src
  if (!sheet || !src) return
  const sharp = document.createElement('img')
  sharp.alt = ''
  sharp.decoding = 'async'
  Object.assign(sharp.style, { position: 'absolute', inset: '0', display: 'block', width: '100%', height: '100%', objectFit: 'cover' })
  sharp.src = src
  // Under the finish (the spine crease and the edge), over the row's image.
  sheet.insertBefore(sharp, sheet.querySelector(':scope > span[aria-hidden]'))
  flight.sharp = sharp
  // In the memory cache already (decoded with the page's image, or preloaded on the press): it is the cover from the first frame.
  if (sharp.complete && sharp.naturalWidth > 0) {
    flight.sharpShown = true
    return
  }
  sharp.style.opacity = '0'
  fadeSoft(flight, copies, rowBox, heroBox, value, sharp)
  const reveal = () => {
    if (flight.sharp !== sharp || !sharp.isConnected || !sharp.naturalWidth) return
    flight.sharpShown = true
    const fade = sharp.animate([{ opacity: 0 }, { opacity: 1 }], { duration: durationToken('quick'), easing: easingToken('standard'), fill: 'both' })
    if (running === flight) flight.channels.cover.push(fade)
  }
  sharp.decode().then(reveal, () => {})
}

function pop(departure: Departure, to: RouteLocationNormalized) {
  const reduced = prefersReducedMotion()
  const flight = fresh(departure)
  running = flight
  const { from } = departure
  const snapshot = departure.snapshot

  showLeaving(flight, snapshot)
  if (flight.snapshot) play(flight.snapshot, [{ opacity: 0 }, { opacity: 1 }], flight, 'book', from.book, reduced)
  const distance = rise()
  for (const sink of departure.sinks)
    play(sink, [{ transform: `translateY(${distance}px)` }, { transform: 'none' }], flight, 'book', from.book, reduced)
  for (const page of livePage())
    play(page, [{ opacity: 1 }, { opacity: 0 }], flight, 'list', from.list, reduced)

  // Back into the list only where it came from, and only if its row is on screen.
  const origin = departure.origin
  const back = !origin || (!origin.search && origin.page === to.fullPath)
  const row = !reduced && back ? coverFor(departure.path) : null
  const rowBox = row ? box(row) : null
  const heroBox = departure.box
  const air = departure.air

  if (row && rowBox && onScreen(rowBox, viewport()) && heroBox && layers) {
    hide(flight, row)
    // Its row is in a sheet that came back with the page (UiSheet's `restore`): the cover flies over it.
    if (row.closest('[role="dialog"]')) layers.over.setAttribute(OVER_SHEET, '')
    standAside(snapshot, departure.cover)
    flight.rowBox = rowBox
    flight.heroBox = heroBox
    flight.row = row
    const rowCopy = coverCopy(row)
    const copies = [rowCopy]
    // The hero's own image (large) flies the whole way, opaque, and stays until the row has its own
    // decoded (`handOff`): the list's image is sized for its row, so it is never shown blown up on the way.
    const top = departure.coverShown && departure.copy
    if (top) copies.push(departure.copy!)
    flight.fly = flyAt(heroBox, copies, departure.radius)
    layers.over.appendChild(flight.fly)
    // Without the hero's image (it was not on screen when Back was tapped) the row's image goes to its
    // thumbhash while the cover is larger than it holds sharply, as it does on the way out.
    if (!top) fadeSoft(flight, [rowCopy], rowBox, heroBox, from.cover)
    play(flight.fly, [{ transform: transformFrom(heroBox, rowBox) }, { transform: 'none' }], flight, 'cover', from.cover, false)
  } else if (air && layers) {
    // Turned around in the air with nowhere to land: the cover fades where it is, with the page.
    flight.fly = flyAt(air.box, air.copies, null)
    standAside(snapshot, departure.cover)
    layers.over.appendChild(flight.fly)
    play(flight.fly, [{ opacity: 0 }, { opacity: 1 }], flight, 'cover', from.book, reduced)
  }
  // Otherwise nowhere to fly to (its row scrolled away, or opened from search): it leaves with its page.
  track(flight)
}

// ------------------------------------------------------------ landing

/** Follows a flight frame by frame: aims a push at its hero once drawn, lands once every part has. */
function track(flight: Flight) {
  layers?.over.setAttribute('data-moving', '')
  const step = () => {
    if (running !== flight) return
    letGo(flight)
    if (flight.waitUntil !== null) {
      const value = channelsOf(flight).cover
      if (!aim(flight, value) && performance.now() > flight.waitUntil) {
        // No hero in time (the book is still loading): the cover fades where it is.
        flight.waitUntil = null
        if (flight.fly) play(flight.fly, [{ opacity: 1 }, { opacity: 0 }], flight, 'cover', 0, false)
      }
    }
    const all = animations(flight)
    const still = all.some((animation) => animation.playState === 'paused')
    if (!still && flight.waitUntil === null && all.every((animation) => animation.playState === 'finished')) land(flight, true)
    else requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/**
 * A flight's first frame shows where it starts, however long it takes to
 * draw: its animations are created holding still (`play`) and let go on the
 * next frame, once that one is on screen. Putting the layers up (the copy of
 * a whole page, the new page's first layout) makes the first frame a slow one,
 * and Safari on iOS runs the animations in another process on its own clock:
 * started at once, the cover would first show up half way there (on the
 * `standard` curve the first 50 ms are half the travel), and on Back it would
 * even step backwards on the next frame.
 */
function letGo(flight: Flight) {
  for (const animation of flight.held) animation.playbackRate = 1
  flight.held = []
}

/**
 * A flight is over (or is cut short): the live page takes over, pixel for
 * pixel. `ended`: it ran its course (not cut short), so a cover that has
 * flown back to its row may stay on it until the row's own image is ready.
 */
function land(flight: Flight, ended = false) {
  const fly = flight.fly
  const hero = flight.towards === 'book' ? flight.hero : null
  const row = flight.towards === 'list' && ended ? flight.row : null
  // The hero's image in the air, if it has come in: it stays as shown once the flight's animations end.
  const sharp = flight.sharpShown ? flight.sharp : null
  if (sharp) sharp.style.opacity = '1'
  flight.fly = null
  drop(flight)
  if (flight.towards === 'book' && flight.origin) remember(flight.path, flight.origin)
  // The hero's own image is not on screen yet: the copy stays on it until it is, if it shows that
  // image (or a cloth). Else the copy goes: the hero shows its thumbhash and fades its image in there.
  const sharpOrCloth = Boolean(sharp) || !fly?.querySelector('img')
  if (fly && hero && hero.isConnected && !shown(hero) && sharpOrCloth) hold(fly, hero)
  // Back into its row: the copy (the hero's large image) stays on the row until the row's own image
  // is decoded and showing, then gives way to it.
  else if (fly && row && row.isConnected && fly.querySelector('img')) handOff(fly, row)
  else fly?.remove()
}

function remember(path: string, origin: Origin) {
  origins.delete(path)
  origins.set(path, origin)
  if (origins.size > ORIGINS_KEPT) origins.delete(origins.keys().next().value!)
}

/** Takes a flight off the screen at once. */
function drop(flight: Flight) {
  for (const animation of animations(flight)) animation.cancel()
  flight.channels = { cover: [], book: [], list: [] }
  flight.held = []
  flight.waitUntil = null
  flight.snapshot?.remove()
  flight.fly?.remove()
  for (const cover of flight.hidden) cover.removeAttribute(HIDDEN)
  flight.hidden = []
  if (running === flight) {
    running = null
    layers?.over.removeAttribute('data-moving')
    layers?.over.removeAttribute(OVER_SHEET)
  }
}

/**
 * The cover has landed with the hero's image (or a cloth) but the hero's own
 * image is not on screen yet (its decode, its fade): the copy that flew moves
 * into the hero's sheet, on top of it, and stays there until the hero's image
 * is decoded and in. In the page, it scrolls, fades and leaves with the hero,
 * under the chrome like it; the cover never shows twice.
 */
function hold(fly: HTMLElement, hero: HTMLElement) {
  keep(fly, hero, () => shown(hero), false)
}

/**
 * The cover has flown back to its row (docs/MOTION.md, Push to a book, Back).
 * The row's image is sized for the row and was off the document while the book
 * page was open, so it may not be decoded yet (a browser drops what it is not
 * showing), or not even loaded (a row opened before its image came): handing
 * the cover to it at once would show its thumbhash, or a blur, for a moment.
 * The copy that flew, showing the hero's large image at the row's size, moves
 * into the row's sheet and stays there until the row's own image is decoded and
 * showing, then fades out over it (`quick`: a frame or two at the same size).
 */
function handOff(fly: HTMLElement, row: HTMLElement) {
  const image = row.querySelector<HTMLImageElement>(':scope > img')
  // The copy was drawn with the hero's corners; the row's own take over.
  const radius = getComputedStyle(row).borderRadius
  for (const copy of fly.children) if (copy instanceof HTMLElement) copy.style.borderRadius = radius
  let decoded = !image
  image?.decode().then(
    () => (decoded = true),
    () => (decoded = true),
  )
  keep(fly, row, () => decoded && shown(row), true)
}

/** Moves the flown copy into `cover`'s sheet, until `ready`; `fade` lets it go gently instead of at once. */
function keep(fly: HTMLElement, cover: HTMLElement, ready: () => boolean, fade: boolean) {
  const held = document.createElement('div')
  held.className = 'flight-held'
  held.dataset.testid = 'shell.flightHeld'
  held.append(...fly.children)
  // In the page now: not a cover of its own for anything that looks for one.
  for (const copy of held.querySelectorAll('[data-cover]')) copy.removeAttribute('data-cover')
  fly.remove()
  cover.appendChild(held)
  let frame = 0
  const release = (gently = false) => {
    cancelAnimationFrame(frame)
    if (releaseHold === release) releaseHold = null
    if (!gently) return held.remove()
    const out = held.animate([{ opacity: 1 }, { opacity: 0 }], { duration: durationToken('quick'), easing: easingToken('standard'), fill: 'both' })
    out.finished.then(() => held.remove(), () => held.remove())
  }
  const check = () => {
    if (!cover.isConnected) release()
    else if (ready()) release(fade)
    else frame = requestAnimationFrame(check)
  }
  releaseHold?.()
  releaseHold = release
  frame = requestAnimationFrame(check)
}

// ------------------------------------------------------------ wiring

/**
 * Called once by ShellBookFlight with its layers: listens to the router for
 * Back and for the moment each new page is drawn. Returns the undo.
 */
export function installBookFlight(app: Router, mounted: Layers): () => void {
  router = app
  layers = mounted
  const original = app.options.scrollBehavior
  const scrollBehavior: RouterScrollBehavior = (to, from, saved) => {
    const result = original ? original(to, from, saved) : false
    // Registered before the router's own scroll, so the flight starts in the same frame, just ahead of it.
    void Promise.resolve(result).then(
      (position) => arrive(to, from, position),
      () => arrive(to, from, null),
    )
    return result
  }
  app.options.scrollBehavior = scrollBehavior
  // Read when the flight starts, long after the popstate (the router's guards and the new page come first).
  const onPopstate = (event: PopStateEvent) => {
    browserAnimatedBack = Boolean((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition)
  }
  window.addEventListener('popstate', onPopstate, { capture: true })
  const stopLeaving = app.beforeEach((to, from) => {
    leaving(to, from)
  })
  const stopAfter = app.afterEach((to, _from, failure) => {
    if (!failure) {
      entryPosition = (window.history.state as { position?: number } | null)?.position ?? null
      return
    }
    // The navigation a flight was waiting for did not happen: the flight it paused carries on.
    if (!pending || pending.to !== to.fullPath) return
    const previous = pending.previous
    pending = null
    unpose()
    if (previous) for (const animation of animations(previous)) animation.play()
  })
  return () => {
    stopLeaving()
    stopAfter()
    window.removeEventListener('popstate', onPopstate, { capture: true })
    if (app.options.scrollBehavior === scrollBehavior) app.options.scrollBehavior = original
    if (running) land(running)
    releaseHold?.()
    unpose()
    pending = null
    layers = null
    router = null
  }
}

export function useBookFlight() {
  return { launch, prepare }
}
