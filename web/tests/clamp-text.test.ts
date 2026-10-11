// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import ClampText from '../app/components/ui/ClampText.vue'

/**
 * The reading history's review text (components/ui/ClampText.vue): two lines, and a quiet
 * "more" only when the text is really cut. jsdom does no layout, so the truncation is mocked
 * (scrollHeight past clientHeight) and the heights the transition reads are stubbed.
 */

const LABELS: Record<string, string> = { 'review.more': 'more', 'review.less': 'less' }

let cut = false
let container: HTMLElement
let app: ReturnType<typeof createApp> | null = null

function mount(text: string, onRowClick = () => {}) {
  container = document.createElement('div')
  container.addEventListener('click', onRowClick)
  document.body.appendChild(container)
  app = createApp({ render: () => h('div', { class: 'row' }, [h(ClampText, { text, testid: 'history.review' })]) })
  app.mount(container)
  return container
}

const button = () => container.querySelector<HTMLButtonElement>('[data-testid="history.review.more"]')
const body = () => container.querySelector<HTMLElement>('[data-testid="history.review"]')!
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  cut = false
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => LABELS[key] ?? key }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduceMotion && query.includes('reduce'), media: query }))
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => (cut ? 90 : 40) })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 40 })
  // The folded text is 40 px tall, the open one 100 px (what a real layout would give).
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { height: this.classList.contains('clamp-folded') ? 40 : 100 } as DOMRect
  }
  HTMLElement.prototype.animate = vi.fn(() => ({ onfinish: null, oncancel: null, cancel: vi.fn() })) as unknown as typeof HTMLElement.prototype.animate
})

afterEach(() => {
  app?.unmount()
  app = null
  container?.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

let reduceMotion = false

describe('ClampText: the "more" control', () => {
  it('shows no button for text that fits', async () => {
    cut = false
    mount('A short note.')
    await settle()
    expect(button()).toBeNull()
    expect(body().classList.contains('clamp-folded')).toBe(true)
  })

  it('shows a real button with aria-expanded=false when the text is cut', async () => {
    cut = true
    mount('A long note that runs past two lines.')
    await settle()
    const more = button()!
    expect(more.tagName).toBe('BUTTON')
    expect(more.type).toBe('button')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.textContent?.trim()).toBe('more')
    expect(more.getAttribute('aria-controls')).toBe(body().id)
  })

  it('expands in place, offers "less", and collapses again', async () => {
    cut = true
    mount('A long note that runs past two lines.')
    await settle()

    button()!.click()
    await nextTick()
    expect(button()!.getAttribute('aria-expanded')).toBe('true')
    expect(button()!.textContent?.trim()).toBe('less')
    expect(body().classList.contains('clamp-folded')).toBe(false)

    button()!.click()
    await nextTick()
    expect(button()!.getAttribute('aria-expanded')).toBe('false')
    expect(button()!.textContent?.trim()).toBe('more')
    expect(body().classList.contains('clamp-folded')).toBe(true)
  })

  it('does not let its click reach the row', async () => {
    cut = true
    const onRowClick = vi.fn()
    mount('A long note that runs past two lines.', onRowClick)
    await settle()
    button()!.click()
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('animates the height over the standard duration, and not with Reduce Motion', async () => {
    cut = true
    mount('A long note that runs past two lines.')
    await settle()
    button()!.click()
    await nextTick()
    expect(HTMLElement.prototype.animate).toHaveBeenCalledTimes(1)
    const [keyframes] = (HTMLElement.prototype.animate as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(keyframes).toEqual([{ height: '40px' }, { height: '100px' }])
  })

  it('does not animate with Reduce Motion on', async () => {
    reduceMotion = true
    cut = true
    mount('A long note that runs past two lines.')
    await settle()
    button()!.click()
    await nextTick()
    expect(HTMLElement.prototype.animate).not.toHaveBeenCalled()
    expect(button()!.getAttribute('aria-expanded')).toBe('true')
    reduceMotion = false
  })
})
