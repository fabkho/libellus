/**
 * A still copy of what a page shows, for the moment it leaves the screen: the
 * router swaps pages at once (the tab pages are kept alive off the document),
 * so the page being left is copied into a fixed layer and fades out there
 * while the next one comes in (composables/useBookFlight.ts).
 *
 * Only what is on screen is copied in full. An element wholly outside the
 * viewport becomes an empty box of its size, so a Library of hundreds of rows
 * costs a screenful of nodes and the copy still lays out where the page was.
 * The copy is dead: no ids or test IDs (the page's own stay unique), no
 * focus, no taps, hidden from assistive technology by its layer.
 */

export interface Snapshot {
  /** The copy, positioned in a layer that covers the viewport. */
  root: HTMLElement
  /** The copy of an element of the page (if it was copied). */
  copyOf(element: Element): Element | undefined
  /** Call once the root is in the document: restores inner scroll offsets and pinned (sticky) headers. */
  settle(): void
}

export function snapshotOf(parts: Iterable<Element>, options: { hide?: (Element | null)[] } = {}): Snapshot {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const copies = new Map<Element, Element>()
  const scrolled: [Element, number, number][] = []
  const sticky: [Element, DOMRect][] = []

  function copy(element: Element): Element {
    if (element instanceof SVGElement) {
      const deep = element.cloneNode(true) as Element
      copies.set(element, deep)
      return scrub(deep)
    }
    const shallow = scrub(element.cloneNode(false) as Element)
    copies.set(element, shallow)
    if (element.scrollLeft || element.scrollTop) scrolled.push([shallow, element.scrollLeft, element.scrollTop])
    if (element instanceof HTMLElement && getComputedStyle(element).position === 'sticky')
      sticky.push([shallow, element.getBoundingClientRect()])
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
      (shallow as HTMLInputElement).value = element.value
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) shallow.appendChild(child.cloneNode())
      else if (child instanceof Element) shallow.appendChild(away(child) ? stub(child) : copy(child))
    }
    return shallow
  }

  /** Wholly off screen (and not a box without size, like `display: contents`). */
  function away(element: Element): boolean {
    const r = element.getBoundingClientRect()
    if (!r.width && !r.height) return false
    return r.bottom < 0 || r.top > viewport.height || r.right < 0 || r.left > viewport.width
  }

  /** An empty box where an element off screen was, so what follows it stays in place. */
  function stub(element: Element): Element {
    const r = element.getBoundingClientRect()
    const empty = scrub(element.cloneNode(false) as Element)
    if (empty instanceof HTMLElement || empty instanceof SVGElement) {
      empty.style.width = `${r.width}px`
      empty.style.height = `${r.height}px`
      empty.style.visibility = 'hidden'
    }
    return empty
  }

  const root = document.createElement('div')
  root.style.cssText = 'position:absolute;inset:0;'
  for (const part of parts) {
    const r = part.getBoundingClientRect()
    const copied = copy(part) as HTMLElement
    copied.style.position = 'absolute'
    copied.style.left = `${r.left}px`
    copied.style.top = `${r.top}px`
    copied.style.width = `${r.width}px`
    copied.style.height = `${r.height}px`
    copied.style.margin = '0'
    root.appendChild(copied)
  }
  for (const hidden of options.hide ?? []) {
    const copied = hidden && copies.get(hidden)
    if (copied instanceof HTMLElement || copied instanceof SVGElement) copied.style.visibility = 'hidden'
  }

  return {
    root,
    copyOf: (element) => copies.get(element),
    settle() {
      for (const [element, left, top] of scrolled) {
        element.scrollLeft = left
        element.scrollTop = top
      }
      // A pinned header was where the page's scroll held it, not where it sits in the flow.
      for (const [element, was] of sticky) {
        if (!(element instanceof HTMLElement)) continue
        element.style.position = 'relative'
        element.style.top = '0px'
        const now = element.getBoundingClientRect()
        element.style.transform = `translateY(${was.top - now.top}px)`
      }
    },
  }
}

/** The copy takes no part in the page: no ids, test IDs, focus, flight marks or loading later. */
function scrub(element: Element): Element {
  element.removeAttribute('id')
  element.removeAttribute('data-testid')
  element.removeAttribute('autofocus')
  element.removeAttribute('data-moving')
  element.removeAttribute('data-flight')
  if (element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1')
  if (element instanceof HTMLImageElement) {
    // Already decoded on the page: drawn on the first frame, not after a lazy look.
    element.loading = 'eager'
    element.decoding = 'sync'
  }
  return element
}

/** A copy of one cover (its whole sheet: image or cloth, thumbhash under it), for the flight. */
export function coverCopy(sheet: Element): HTMLElement {
  const copied = sheet.cloneNode(true) as HTMLElement
  for (const element of [copied, ...copied.querySelectorAll('*')]) scrub(element)
  copied.removeAttribute('data-flight-hidden')
  return copied
}
