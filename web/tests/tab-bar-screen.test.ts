import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { barOnScreen } from '@/utils/tabBar'

/**
 * The tab bar on a screen that fills the room (docs/MOTION.md, "Tab bar away";
 * `components/shell/TabBar.vue`). Entered from a tab, the bar used to be drawn at its resting place over
 * the new page's content and then slide away over `exit`: the same screen entered twice (from a reload,
 * and from the tab bar) looked like two different screens, and the second one flashed the old chrome over
 * the thread's composer for the length of that slide. It leaves with the page it belongs to instead: away,
 * and still, from the screen's first frame.
 */
const screen = (over: Partial<Parameters<typeof barOnScreen>[0]> = {}) => barOnScreen({ immersive: false, scrolledAway: false, searchOpen: false, morphing: false, ...over })

describe('the tab bar on a screen', () => {
  it('is away and still at once on a screen that fills the room: nothing slides over the new page', () => {
    // `still` is what the stylesheet reads for `transition: none`: the bar is never drawn at its resting
    // place first. `away` alone would animate it out over whatever the new screen drew under it.
    expect(screen({ immersive: true })).toEqual({ away: true, still: true })
  })

  it('slides away only where the member scrolled the page: the same screen, the same bar', () => {
    expect(screen({ scrolledAway: true })).toEqual({ away: true, still: false })
  })

  it('is where it rests, with no transition, while the palette takes it over', () => {
    // The search morph measures the capsule where it rests, so it is there at once.
    expect(screen({ searchOpen: true })).toEqual({ away: false, still: true })
    expect(screen({ morphing: true })).toEqual({ away: false, still: true })
  })

  it('is on the page and moving normally on any other screen', () => {
    expect(screen()).toEqual({ away: false, still: false })
  })

  it('does not let a page hidden by its scroll keep the bar away on a screen that fills the room', () => {
    // Both are true at once coming from a tab that had scrolled: the immersive rule wins, and still.
    expect(screen({ immersive: true, scrolledAway: true })).toEqual({ away: true, still: true })
  })

  it('is what the bar draws: the page’s own class and the stylesheet’s `still`', () => {
    // The rule is only worth anything if the component reads it: the bar's classes come from one place,
    // and `still` is the class that takes its transition away (`TabBar.vue`, "The bar's own state").
    const bar = readFileSync(new URL('../app/components/shell/TabBar.vue', import.meta.url), 'utf8')
    expect(bar).toContain('barOnScreen({')
    expect(bar).toContain('})')
    expect(bar).toMatch(/bar\.away && 'away'/)
    expect(bar).toMatch(/bar\.still && 'still'/)
    expect(bar).toMatch(/:data-away="bar\.away \|\| undefined"/)
  })
})
