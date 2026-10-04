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
 * - A cover that lands before the hero's own image is in stays on the hero, in
 *   its sheet, until that image is decoded and faded in (`hold`).
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
  isBookPath,
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

/** The parts of the shell that are the page: the tab page's header and `main` (layouts/tabs.vue). */
const PAGE = '[data-flight="page"]'
const HERO = '[data-testid="book.hero"]'
/** A cover's sheet (UiCover): the image or cloth, without its glow. */
const COVER = '[data-cover]'
/** A cover that is flying: the copy in the air stands in for it. */
const HIDDEN = 'data-flight-hidden'
const LAYER = '[data-flight-layer]'
/** On the root while a flight is about to start: the live page is hidden under the copy of the page being left. */
const POSE = 'data-flight-pose'
/**
 * How long the copy of the page being left may stand in for it before the
 * navigation has drawn the new page (a slow first load of the page's code):
 * a safety net, not a motion; after it the live page shows again.
 */
const POSE_LIMIT_MS = 1000

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
  origin: Origin | null
}

let layers: Layers | null = null
let router: Router | null = null
let pending: Departure | null = null
let running: Flight | null = null
let releaseHold: (() => void) | null = null
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
  return towards === 'book' ? frames : [...frames].reverse()
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

/** A tap on a link to a book page: called by UiPressLink before it navigates. */
export function launch(link: HTMLElement, to: string) {
  if (!layers || !router || !import.meta.client) return
  const path = router.resolve(to).path
  if (!isBookPath(path) || path === router.currentRoute.value.path) return
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
  if (pending || !isBookPath(from.path) || to.path === from.path) return
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
  // Its own image already drawn (or a cloth with its type): it fades in over the list's on the way.
  if (shown(hero)) {
    const top = coverCopy(hero)
    top.classList.add('flight-copy')
    top.style.borderRadius = radius
    fly.appendChild(top)
    play(top, [{ opacity: 0 }, { opacity: 1 }], flight, 'cover', value, false)
  }
  play(fly, [{ transform: transformFrom(heroBox, rowBox) }, { transform: 'none' }], flight, 'cover', value, false)
  return true
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
    standAside(snapshot, departure.cover)
    flight.rowBox = rowBox
    flight.heroBox = heroBox
    const copies = [coverCopy(row)]
    const top = departure.coverShown && departure.copy
    if (top) copies.push(departure.copy!)
    flight.fly = flyAt(heroBox, copies, departure.radius)
    layers.over.appendChild(flight.fly)
    if (top) play(departure.copy!, [{ opacity: 0 }, { opacity: 1 }], flight, 'cover', from.cover, false)
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
    if (!still && flight.waitUntil === null && all.every((animation) => animation.playState === 'finished')) land(flight)
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

/** A flight is over (or is cut short): the live page takes over, pixel for pixel. */
function land(flight: Flight) {
  const fly = flight.fly
  const hero = flight.towards === 'book' ? flight.hero : null
  flight.fly = null
  drop(flight)
  if (flight.towards === 'book' && flight.origin) remember(flight.path, flight.origin)
  // The hero's own image is not on screen yet: the copy stays on it until it is.
  if (fly && hero && hero.isConnected && !shown(hero)) hold(fly, hero)
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
  }
}

/**
 * The cover has landed but the hero's own image is not on screen yet (still
 * loading, or fading in): the copy that flew moves into the hero's sheet, on
 * top of it, and stays there until the hero's image is decoded and in. In the
 * page, it scrolls, fades and leaves with the hero, under the chrome like it;
 * the cover never falls back to its thumbhash, and never shows twice.
 */
function hold(fly: HTMLElement, hero: HTMLElement) {
  const held = document.createElement('div')
  held.className = 'flight-held'
  held.dataset.testid = 'shell.flightHeld'
  held.append(...fly.children)
  // In the page now: not a cover of its own for anything that looks for one.
  for (const copy of held.querySelectorAll('[data-cover]')) copy.removeAttribute('data-cover')
  fly.remove()
  hero.appendChild(held)
  let frame = 0
  const release = () => {
    cancelAnimationFrame(frame)
    held.remove()
    if (releaseHold === release) releaseHold = null
  }
  const check = () => {
    if (!hero.isConnected || shown(hero)) release()
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
  return { launch }
}
